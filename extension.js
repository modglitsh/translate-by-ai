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
			clip_to_allocation: true,
		});

		this.inputEntry = new St.Entry({
			name: 'inputEntry',
			style_class: 'entry',
			can_focus: true,
			hint_text: _('Type here to translate...'),
			track_hover: true
		});
		this.inputEntry.get_clutter_text().set_single_line_mode(false);
		this.inputEntry.get_clutter_text().set_line_wrap(true);
		this.inputEntry.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
		this.inputEntry.get_clutter_text().set_max_length(0);

		let _boxI = new St.BoxLayout({ vertical: true });
		_boxI.add_child(this.inputEntry);
		this.scrollInput.add_child(_boxI);

		let inputActor = new St.BoxLayout({
			style_class: 'translate-main-container',
			reactive: true,
			vertical: true
		});
		inputActor.add_child(this.scrollInput);
		inputMenuItem.actor.add_child(inputActor);
		this.menu.addMenuItem(inputMenuItem);

		// --- OUTPUT SECTION (PopupMenuSection for scrolling) ---
		let outputSection = new PopupMenu.PopupMenuSection();

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
					this.inputEntry.get_clutter_text().grab_key_focus();
					this._updateScrollHeight(this.inputEntry, this.scrollInput, true);
					this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);
				}
			}, 50);
		});
	}

	_onInputTextChanged() {
		this._updateScrollHeight(this.inputEntry, this.scrollInput, true);
	}

	_updateScrollHeight(widget, scrollView, isEntry) {
		let clutterText = isEntry ? widget.get_clutter_text() : widget.clutter_text;
		let layout = clutterText.get_layout();
		if (!layout) return;

		if (layout.get_line_count() > 8) {
			scrollView.set_height(250);
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

			this._translateWithLLM(inputText).then((result) => {
				this.outputLabel.set_text(result);
				this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);
			}).catch((error) => {
				this.outputLabel.set_text(_('❌ Error: ') + error.message);
				this._updateScrollHeight(this.outputLabel, this.scrollOutput, false);
			});

			return Clutter.EVENT_STOP;
		}
		return Clutter.EVENT_PROPAGATE;
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
