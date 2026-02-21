import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';

import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import {
	Fields,
	SCHEMA_NAME,
	SETTING_KEY_TRANSLATE_MENU,
} from './schema.js';

const INDICATOR_ICON = 'insert-text-symbolic';
const EXTENSION_PATH = GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/translate-by-ai@by-ai.net/';

export default class TranslateIndicatorExtension extends Extension {
	enable() {
		this.translateIndicator = new TranslateIndicator({
			clipboard: St.Clipboard.get_default(),
			settings: this.getSettings(SCHEMA_NAME),
		});
		Main.panel.addToStatusArea(this.uuid, this.translateIndicator, 1);
	}

	disable() {
		this.translateIndicator.destroy();
		this.translateIndicator = null;
	}
}

const TranslateIndicator = GObject.registerClass({
	GTypeName: 'TranslateIndicator'
}, class TranslateIndicator extends PanelMenu.Button {
	destroy() {
		this._disconnectSettings();
		this._unbindShortcuts();

		this.extension.settings = null;
		this.extension.clipboard = null;

		if (this._timeoutId) {
			clearTimeout(this._timeoutId);
			this._timeoutId = null;
		}

		if (this._session) {
			this._session = null;
		}

		super.destroy();
	}

	_init(extension) {
		super._init(0.0, "TranslateIndicator");
		this.extension = extension;

		this._settingsChangedId = null;
		this._shortcutsBindingIds = [];
		this._session = new Soup.Session();

		// LLM settings cache
		this._llmApiKey = '';
		this._llmBaseUrl = '';
		this._llmModel = '';
		this._llmSystemPrompt = '';
		this._llmUserPrompt = '';
		this._llmSourceLang = '';
		this._llmTargetLang = '';

		// UI Settings cache
		this._uiWidth = 550;
		this._uiMaxHeight = 250;

		let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box translate-indicator-hbox' });
		this.icon = new St.Icon({
			style_class: 'system-status-icon'
		});
		this.icon.gicon = Gio.icon_new_for_string(`${EXTENSION_PATH}icons/icon.svg`);
		hbox.add_child(this.icon);
		this.actor.add_child(hbox);

		this._loadSettings();
		this._buildMenu();
		this._fetchSettings();
	}

	_buildMenu() {
		let that = this;

		// --- INPUT SECTION ---
		let inputMenuItem = new PopupMenu.PopupBaseMenuItem({
			reactive: false,
			can_focus: false
		});

		this.scrollInput = new St.ScrollView({
			style_class: 'entry-container',
			hscrollbar_policy: St.PolicyType.NEVER,
			vscrollbar_policy: St.PolicyType.AUTOMATIC,
			overlay_scrollbars: true,
			clip_to_allocation: true,
		});

		this.inputEntry = new St.Entry({
			name: 'inputEntry',
			style_class: 'entry',
			can_focus: true,
			hint_text: _('Type here to translate...'),
			track_hover: true
		});
		this.inputEntry.set_width(this._uiWidth);
		this.inputEntry.get_clutter_text().set_single_line_mode(false);
		this.inputEntry.get_clutter_text().set_line_wrap(true);
		this.inputEntry.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
		this.inputEntry.get_clutter_text().set_max_length(0);

		let _boxI = new St.BoxLayout({ vertical: true });
		_boxI.add_child(this.inputEntry);
		this.scrollInput.add_child(_boxI);

		let speakInputBtn = new St.Button({
			style_class: 'button translate-speak-button',
			child: new St.Icon({
				icon_name: 'audio-input-microphone-symbolic', // Microphone icon 
				style_class: 'popup-menu-icon'
			}),
			x_align: Clutter.ActorAlign.END,
			opacity: 0, // Hidden by default
			reactive: false,
		});

		this.speakInputBtn = speakInputBtn; // Store reference

		speakInputBtn.connect('clicked', () => {
			let text = this.inputEntry.get_text();
			if (text && text.trim().length > 0) {
				this._speakText(text);
			}
		});

		let inputFooter = new St.BoxLayout({
			style_class: 'translate-output-header',
			x_expand: true,
			x_align: Clutter.ActorAlign.END,
		});
		inputFooter.add_child(speakInputBtn);

		let inputActor = new St.BoxLayout({
			style_class: 'translate-main-container',
			reactive: true,
			vertical: true
		});
		inputActor.add_child(this.scrollInput);
		inputActor.add_child(inputFooter);
		inputMenuItem.actor.add_child(inputActor);
		this.menu.addMenuItem(inputMenuItem);


		// --- OUTPUT SECTION (PopupMenuSection for scrolling) ---
		let outputSection = new PopupMenu.PopupMenuSection();

		// Header with Copy Button
		let outputHeader = new St.BoxLayout({
			style_class: 'translate-output-header',
			x_expand: true,
			x_align: Clutter.ActorAlign.END,
		});

		let speakBtn = new St.Button({
			style_class: 'button translate-speak-button',
			child: new St.Icon({
				icon_name: 'audio-input-microphone-symbolic',
				style_class: 'popup-menu-icon'
			}),
			x_align: Clutter.ActorAlign.END,
			opacity: 0, // Hidden by default
			reactive: false,
		});

		this.speakBtn = speakBtn; // Store reference

		speakBtn.connect('clicked', () => {
			let text = this.outputLabel.get_text();
			if (text && text !== _('⏳ Translating...') && !text.startsWith(_('❌ Error:'))) {
				this._speakText(text);
			}
		});

		let copyBtn = new St.Button({
			style_class: 'button translate-copy-button',
			child: new St.Icon({
				icon_name: 'edit-copy-symbolic',
				style_class: 'popup-menu-icon'
			}),
			x_align: Clutter.ActorAlign.END,
			opacity: 0, // Hidden by default
			reactive: false,
		});

		this.copyBtn = copyBtn; // Store reference

		copyBtn.connect('clicked', () => {
			let text = this.outputLabel.get_text();
			if (text && text !== _('⏳ Translating...') && !text.startsWith(_('❌ Error:'))) {
				this._copyToClipboard(text);
				this._showNotification(_('Copied to clipboard!'));
			}
		});

		outputHeader.add_child(speakBtn);
		outputHeader.add_child(copyBtn);
		outputSection.actor.add_child(outputHeader);

		this.scrollOutput = new St.ScrollView({
			style_class: 'translate-output-scroll',
			hscrollbar_policy: St.PolicyType.NEVER,
			vscrollbar_policy: St.PolicyType.AUTOMATIC,
			overlay_scrollbars: true,
			clip_to_allocation: true,
		});

		this.outputLabel = new St.Label({
			name: 'outputLabel',
			style_class: 'translate-output',
			reactive: true,
		});
		this.outputLabel.set_width(this._uiWidth);
		this.outputLabel.clutter_text.set_selectable(true);
		this.outputLabel.clutter_text.set_line_wrap(true);
		this.outputLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
		this.outputLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

		let _boxO = new St.BoxLayout({ vertical: true });
		_boxO.add_child(this.outputLabel);
		this.scrollOutput.add_child(_boxO);

		outputSection.actor.add_child(this.scrollOutput);
		this.menu.addMenuItem(outputSection);

		// --- Events ---
		that.inputEntry.get_clutter_text().connect(
			'text-changed',
			that._onInputTextChanged.bind(that)
		);
		this.inputEntry.get_clutter_text().connect('key-press-event', (object, event) => {
			this._on_key_press_event(object, event);
		});

		that.menu.connect('open-state-changed', (self, open) => {
			this._timeoutId = setTimeout(() => {
				if (open) {
					// Auto-focus input
					this.inputEntry.get_clutter_text().grab_key_focus();
					this._updateScrollHeight(this.inputEntry, this.scrollInput, true);
					this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);

					// Smart Selection Logic: Grab Primary Selection
					this.extension.clipboard.get_text(St.ClipboardType.PRIMARY, (clipboard, text) => {
						if (text && text.trim().length > 0) {
							// Always overwrite if there's a new selection
							let cleanText = text.trim();
							// Optional: checking if it's different to avoid re-translating same text
							// But user might want to re-translate, so we overwrite.
							this.inputEntry.set_text(cleanText);
							this._updateScrollHeight(this.inputEntry, this.scrollInput, true);

							// Clear previous output
							this.outputLabel.set_text('');
							this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);
							this.copyBtn.opacity = 0;
							this.copyBtn.reactive = false;
							this.speakBtn.opacity = 0;
							this.speakBtn.reactive = false;

							if (this._isEnglish(cleanText)) {
								this.speakInputBtn.opacity = 255;
								this.speakInputBtn.reactive = true;
							} else {
								this.speakInputBtn.opacity = 0;
								this.speakInputBtn.reactive = false;
							}

							// Auto-submit
							this._on_key_press_event(this.inputEntry, {
								get_key_symbol: () => 65293 // Fake Enter key
							});
						}
					});
				}
			}, 50);
		});
	}

	_onInputTextChanged() {
		this._updateScrollHeight(this.inputEntry, this.scrollInput, true);
		let text = this.inputEntry.get_text();
		if (text && this._isEnglish(text)) {
			this.speakInputBtn.opacity = 255;
			this.speakInputBtn.reactive = true;
		} else {
			this.speakInputBtn.opacity = 0;
			this.speakInputBtn.reactive = false;
		}
	}

	_updateScrollHeight(widget, scrollView, isEntry) {
		let clutterText = isEntry ? widget.get_clutter_text() : widget.clutter_text;
		let layout = clutterText.get_layout();
		if (!layout) return;

		let maxH = this._uiMaxHeight || 250;

		// Use exact pixel height of the text block to determine if scrollbar is needed
		let extents = layout.get_pixel_extents();
		let logicalHeight = extents[1].height + (isEntry ? 30 : 20); // Add container padding buffer

		if (logicalHeight > maxH) {
			scrollView.set_height(maxH);
		} else {
			scrollView.set_height(-1);
		}
	}

	_on_key_press_event(_object, event) {
		let symbol = event.get_key_symbol();

		// Enter key
		if (symbol === 65293) {
			let inputText = this.inputEntry.get_text().trim();
			if (!inputText) return Clutter.EVENT_PROPAGATE;

			this.outputLabel.set_text(_('⏳ Translating...'));
			this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);
			this.copyBtn.opacity = 0;
			this.copyBtn.reactive = false;
			this.speakBtn.opacity = 0;
			this.speakBtn.reactive = false;

			this._translateWithLLM(inputText).then((result) => {
				this.outputLabel.set_text(result);
				this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);
				this.copyBtn.opacity = 255;
				this.copyBtn.reactive = true;
				if (this._isEnglish(result)) {
					this.speakBtn.opacity = 255;
					this.speakBtn.reactive = true;
				} else {
					this.speakBtn.opacity = 0;
					this.speakBtn.reactive = false;
				}
				// Re-focus input after translation
				this.inputEntry.get_clutter_text().grab_key_focus();
			}).catch((error) => {
				this.outputLabel.set_text(_('❌ Error: ') + error.message);
				this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);
				this.copyBtn.opacity = 0;
				this.copyBtn.reactive = false;
				this.speakBtn.opacity = 0;
				this.speakBtn.reactive = false;
			});

			return Clutter.EVENT_STOP;
		}
		return Clutter.EVENT_PROPAGATE;
	}

	_copyToClipboard(text) {
		this.extension.clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
	}

	_speakText(text) {
		if (!this.extension.settings.get_boolean(Fields.TTS_ENABLED)) {
			return; // Do nothing if TTS is disabled
		}

		try {
			// Determine the path to edge-playback
			let edgePlaybackPath = GLib.get_home_dir() + '/.local/bin/edge-playback';

			// If not in standard pipx/local path, check system path
			if (!GLib.file_test(edgePlaybackPath, GLib.FileTest.EXISTS)) {
				let systemPath = GLib.find_program_in_path('edge-playback');
				if (systemPath) {
					edgePlaybackPath = systemPath;
				} else {
					// edge-playback is completely missing
					this._showNotification(_('Text-to-Speech Error: edge-tts is not installed. Please install it using pip or pipx.'));
					console.error('edge-playback not found in ~/.local/bin/ or system PATH');
					return;
				}
			}

			// Cancel any currently playing audio
			GLib.spawn_command_line_async('pkill -f edge-tts');
			GLib.spawn_command_line_async('pkill -f mpv');
			GLib.spawn_command_line_async('pkill -f edge-playback');

			// Sanitize the text to prevent shell injection, replace ' with '\''
			let safeText = text.replace(/'/g, "'\\''");

			// Get voice from settings
			let voice = this.extension.settings.get_string(Fields.TTS_VOICE) || 'en-US-AriaNeural';

			// Try to spawn the edge-playback command
			GLib.spawn_command_line_async(`${edgePlaybackPath} --voice ${voice} --text '${safeText}'`);

		} catch (error) {
			console.error('Failed to trigger text-to-speech:', error);
			this._showNotification(_('Failed to play audio. Error: ' + error.message));
		}
	}

	_isEnglish(text) {
		const arabicRegex = /[\u0600-\u06FF]/;
		if (arabicRegex.test(text)) {
			return false;
		}
		const englishRegex = /[a-zA-Z]/;
		return englishRegex.test(text);
	}

	// ===== LLM Translation via API =====

	async _translateWithLLM(text) {
		if (!this._llmApiKey) {
			throw new Error(_('API Key is not set. Go to extension settings → LLM tab.'));
		}

		const baseUrl = this._llmBaseUrl;
		const model = this._llmModel;
		const systemPrompt = this._llmSystemPrompt;
		const userPrompt = this._llmUserPrompt
			.replace('{text}', text)
			.replace('{source_lang}', this._llmSourceLang)
			.replace('{target_lang}', this._llmTargetLang);

		// Detect API type from base URL
		if (baseUrl.includes('generativelanguage.googleapis.com')) {
			return this._callGeminiAPI(baseUrl, model, systemPrompt, userPrompt);
		} else {
			return this._callOpenAICompatibleAPI(baseUrl, model, systemPrompt, userPrompt);
		}
	}

	// --- Gemini API ---
	async _callGeminiAPI(baseUrl, model, systemPrompt, userPrompt) {
		const url = `${baseUrl}/${model}:generateContent?key=${this._llmApiKey}`;

		const body = JSON.stringify({
			system_instruction: {
				parts: [{ text: systemPrompt }]
			},
			contents: [{
				parts: [{ text: userPrompt }]
			}],
			generationConfig: {
				temperature: 0.3,
				maxOutputTokens: 2048,
			}
		});

		const responseText = await this._httpPost(url, body);
		const response = JSON.parse(responseText);

		if (response.error) {
			throw new Error(response.error.message || 'Gemini API error');
		}

		if (response.candidates && response.candidates[0] &&
			response.candidates[0].content &&
			response.candidates[0].content.parts &&
			response.candidates[0].content.parts[0]) {
			return response.candidates[0].content.parts[0].text;
		}

		throw new Error('Unexpected Gemini response format');
	}

	// --- OpenAI-Compatible API (OpenAI, Groq, Ollama, LM Studio, etc.) ---
	async _callOpenAICompatibleAPI(baseUrl, model, systemPrompt, userPrompt) {
		// Normalize URL: ensure it ends with /chat/completions
		let url = baseUrl.replace(/\/+$/, '');
		if (!url.endsWith('/chat/completions')) {
			url += '/chat/completions';
		}

		const body = JSON.stringify({
			model: model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			temperature: 0.3,
			max_tokens: 2048,
		});

		const headers = {
			'Authorization': `Bearer ${this._llmApiKey}`,
		};

		const responseText = await this._httpPost(url, body, headers);
		const response = JSON.parse(responseText);

		if (response.error) {
			throw new Error(response.error.message || 'API error');
		}

		if (response.choices && response.choices[0] &&
			response.choices[0].message) {
			return response.choices[0].message.content;
		}

		throw new Error('Unexpected API response format');
	}

	// --- HTTP POST using Soup 3 ---
	async _httpPost(url, body, extraHeaders = {}) {
		return new Promise((resolve, reject) => {
			try {
				const message = Soup.Message.new('POST', url);
				if (!message) {
					reject(new Error('Failed to create HTTP message. Check URL.'));
					return;
				}

				message.request_headers.append('Content-Type', 'application/json');
				for (const [key, value] of Object.entries(extraHeaders)) {
					message.request_headers.append(key, value);
				}

				const bytes = new GLib.Bytes(new TextEncoder().encode(body));
				message.set_request_body_from_bytes('application/json', bytes);

				this._session.send_and_read_async(
					message,
					GLib.PRIORITY_DEFAULT,
					null,
					(session, result) => {
						try {
							const responseBytes = session.send_and_read_finish(result);
							const statusCode = message.status_code;

							if (statusCode < 200 || statusCode >= 300) {
								const errorText = new TextDecoder().decode(responseBytes.get_data());
								try {
									const errJson = JSON.parse(errorText);
									reject(new Error(errJson.error?.message || `HTTP ${statusCode}`));
								} catch (e) {
									reject(new Error(`HTTP ${statusCode}: ${errorText.substring(0, 200)}`));
								}
								return;
							}

							const responseData = new TextDecoder().decode(responseBytes.get_data());
							resolve(responseData);
						} catch (error) {
							reject(error);
						}
					}
				);
			} catch (error) {
				reject(error);
			}
		});
	}

	// ===== Settings =====

	_loadSettings() {
		this._settingsChangedId = this.extension.settings.connect('changed',
			this._fetchSettings.bind(this));
		this._fetchSettings();
		this._bindShortcuts();
	}

	_fetchSettings() {
		const { settings } = this.extension;
		this._llmApiKey = settings.get_string(Fields.LLM_API_KEY);
		this._llmBaseUrl = settings.get_string(Fields.LLM_BASE_URL);
		this._llmModel = settings.get_string(Fields.LLM_MODEL);
		this._llmSystemPrompt = settings.get_string(Fields.LLM_SYSTEM_PROMPT);
		this._llmUserPrompt = settings.get_string(Fields.LLM_USER_PROMPT);
		this._llmSourceLang = settings.get_string(Fields.LLM_SOURCE_LANG);
		this._llmTargetLang = settings.get_string(Fields.LLM_TARGET_LANG);

		// Update UI dynamically if already built
		this._uiWidth = settings.get_int(Fields.UI_WIDTH) || 550;
		this._uiMaxHeight = settings.get_int(Fields.UI_MAX_HEIGHT) || 250;

		if (this.inputEntry) {
			this.inputEntry.set_width(this._uiWidth);
		}
		if (this.outputLabel) {
			this.outputLabel.set_width(this._uiWidth);
		}
	}

	_initNotifSource() {
		if (!this._notifSource) {
			this._notifSource = new MessageTray.Source('TranslateIndicator',
				INDICATOR_ICON);
			this._notifSource.connect('destroy', () => {
				this._notifSource = null;
			});
			Main.messageTray.add(this._notifSource);
		}
	}

	_showNotification(message) {
		let notification = null;
		this._initNotifSource();

		if (this._notifSource.count === 0) {
			notification = new MessageTray.Notification(this._notifSource, message);
		} else {
			notification = this._notifSource.notifications[0];
			notification.update(message, '', { clear: true });
		}

		notification.setTransient(true);
		this._notifSource.showNotification(notification);
	}

	_bindShortcuts() {
		this._unbindShortcuts();
		this._bindShortcut(SETTING_KEY_TRANSLATE_MENU, this._toggleMenu);
	}

	_toggleMenu() {
		this.menu.toggle();
	}

	_unbindShortcuts() {
		this._shortcutsBindingIds.forEach(
			(id) => Main.wm.removeKeybinding(id)
		);
		this._shortcutsBindingIds = [];
	}

	_bindShortcut(name, cb) {
		var ModeType = Shell.hasOwnProperty('ActionMode') ?
			Shell.ActionMode : Shell.KeyBindingMode;

		Main.wm.addKeybinding(
			name,
			this.extension.settings,
			Meta.KeyBindingFlags.NONE,
			ModeType.ALL,
			cb.bind(this)
		);

		this._shortcutsBindingIds.push(name);
	}

	_disconnectSettings() {
		if (!this._settingsChangedId)
			return;
		this.extension.settings.disconnect(this._settingsChangedId);
		this._settingsChangedId = null;
	}
});
