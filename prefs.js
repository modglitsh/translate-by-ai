import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { Fields, SCHEMA_NAME } from './schema.js';

export default class TranslateIndicatorPreferences extends ExtensionPreferences {
	fillPreferencesWindow(window) {
		window._settings = this.getSettings(SCHEMA_NAME);
		const settingsUI = new Settings(window._settings);

		// --- Page 1: General (Languages & Shortcuts) ---
		const generalPage = new Adw.PreferencesPage({
			title: _('General'),
			icon_name: 'preferences-system-symbolic',
		});
		generalPage.add(settingsUI.languageGroup);   // New group for languages
		generalPage.add(settingsUI.shortcuts);       // Existing shortcuts group
		window.add(generalPage);

		// --- Page 2: LLM Connection ---
		const llmConnectionPage = new Adw.PreferencesPage({
			title: _('LLM Connection'),
			icon_name: 'network-server-symbolic',
		});
		llmConnectionPage.add(settingsUI.llmGroup);  // Connection settings only
		llmConnectionPage.add(settingsUI.promptGroup); // Prompts
		window.add(llmConnectionPage);
	}
}

class Settings {
	constructor(schema) {
		this.schema = schema;

		// ===== LLM Connection Group =====
		this.llmGroup = new Adw.PreferencesGroup({
			title: _('LLM Connection'),
		});

		// API Key
		this.apiKeyEntry = new Adw.PasswordEntryRow({
			title: _('API Key'),
		});
		this.apiKeyEntry.text = this.schema.get_string(Fields.LLM_API_KEY);
		this.llmGroup.add(this.apiKeyEntry);

		// Base URL
		this.baseUrlEntry = new Adw.EntryRow({
			title: _('Base URL'),
		});
		this.baseUrlEntry.text = this.schema.get_string(Fields.LLM_BASE_URL);
		this.llmGroup.add(this.baseUrlEntry);

		// Model Name
		this.modelEntry = new Adw.EntryRow({
			title: _('Model Name'),
		});
		this.modelEntry.text = this.schema.get_string(Fields.LLM_MODEL);
		this.llmGroup.add(this.modelEntry);

		// ===== Language Group (Source & Target) =====
		this.languageGroup = new Adw.PreferencesGroup({
			title: _('Language Settings'),
		});

		// Source Language
		this.sourceLangEntry = new Adw.EntryRow({
			title: _('Source Language'),
		});
		this.sourceLangEntry.text = this.schema.get_string(Fields.LLM_SOURCE_LANG);
		this.languageGroup.add(this.sourceLangEntry);

		// Target Language
		this.targetLangEntry = new Adw.EntryRow({
			title: _('Target Language'),
		});
		this.targetLangEntry.text = this.schema.get_string(Fields.LLM_TARGET_LANG);
		this.languageGroup.add(this.targetLangEntry);


		// ===== Prompt Group =====
		this.promptGroup = new Adw.PreferencesGroup({
			title: _('Prompts'),
		});

		// System Prompt (Base Role) - Using a text view for multiline
		this.systemPromptText = new Gtk.TextView({
			wrap_mode: Gtk.WrapMode.WORD_CHAR,
			hexpand: true,
			vexpand: true,
			top_margin: 8,
			bottom_margin: 8,
			left_margin: 8,
			right_margin: 8,
		});
		this.systemPromptText.get_buffer().set_text(
			this.schema.get_string(Fields.LLM_SYSTEM_PROMPT), -1
		);
		const systemPromptScroll = new Gtk.ScrolledWindow({
			min_content_height: 80,
			max_content_height: 150,
			hexpand: true,
			css_classes: ['card'],
		});
		systemPromptScroll.set_child(this.systemPromptText);

		const systemPromptBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 8,
			margin_start: 12,
			margin_end: 12,
			margin_top: 8,
			margin_bottom: 8,
		});
		const systemPromptLabel = new Gtk.Label({
			label: _('System Prompt'),
			xalign: 0,
			css_classes: ['title-4'],
		});
		const systemPromptSub = new Gtk.Label({
			xalign: 0,
			css_classes: ['dim-label'],
		});
		systemPromptBox.append(systemPromptLabel);
		systemPromptBox.append(systemPromptSub);
		systemPromptBox.append(systemPromptScroll);
		this.promptGroup.add(systemPromptBox);

		// User Prompt Template
		const userPromptBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 8,
			margin_start: 12,
			margin_end: 12,
			margin_top: 8,
			margin_bottom: 8,
		});
		const userPromptLabel = new Gtk.Label({
			label: _('User Prompt Template'),
			xalign: 0,
			css_classes: ['title-4'],
		});
		const userPromptSub = new Gtk.Label({
			xalign: 0,
			css_classes: ['dim-label'],
		});
		this.userPromptText = new Gtk.TextView({
			wrap_mode: Gtk.WrapMode.WORD_CHAR,
			hexpand: true,
			vexpand: true,
			top_margin: 8,
			bottom_margin: 8,
			left_margin: 8,
			right_margin: 8,
		});
		this.userPromptText.get_buffer().set_text(
			this.schema.get_string(Fields.LLM_USER_PROMPT), -1
		);
		const userPromptScroll = new Gtk.ScrolledWindow({
			min_content_height: 80,
			max_content_height: 150,
			hexpand: true,
			css_classes: ['card'],
		});
		userPromptScroll.set_child(this.userPromptText);
		userPromptBox.append(userPromptLabel);
		userPromptBox.append(userPromptSub);
		userPromptBox.append(userPromptScroll);
		this.promptGroup.add(userPromptBox);


		// ===== Bind simple fields =====
		this.schema.bind(Fields.LLM_API_KEY, this.apiKeyEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
		this.schema.bind(Fields.LLM_BASE_URL, this.baseUrlEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
		this.schema.bind(Fields.LLM_MODEL, this.modelEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
		this.schema.bind(Fields.LLM_SOURCE_LANG, this.sourceLangEntry, 'text', Gio.SettingsBindFlags.DEFAULT);

		this.schema.bind(Fields.LLM_TARGET_LANG, this.targetLangEntry, 'text', Gio.SettingsBindFlags.DEFAULT);

		// For TextViews, we need manual save on buffer change
		this.systemPromptText.get_buffer().connect('changed', () => {
			const [start, end] = this.systemPromptText.get_buffer().get_bounds();
			const text = this.systemPromptText.get_buffer().get_text(start, end, false);
			this.schema.set_string(Fields.LLM_SYSTEM_PROMPT, text);
		});
		this.userPromptText.get_buffer().connect('changed', () => {
			const [start, end] = this.userPromptText.get_buffer().get_bounds();
			const text = this.userPromptText.get_buffer().get_text(start, end, false);
			this.schema.set_string(Fields.LLM_USER_PROMPT, text);
		});


		// ===== Shortcuts Group =====
		this.shortcuts = new Adw.PreferencesGroup({ title: _('Shortcuts') });
		this.buildShortcuts(this.shortcuts);
	}

	_shortcuts = {
		"translate-from-selection": _("Toggle the menu"),
	};

	buildShortcuts(group) {
		for (const key in this._shortcuts) {
			const row = new Adw.ActionRow({
				title: this._shortcuts[key]
			});

			row.add_suffix(this.createShortcutButton(key));

			group.add(row);
		}
	}

	createShortcutButton(pref) {
		const button = new Gtk.Button({
			has_frame: false
		});

		const setLabelFromSettings = () => {
			const originalValue = this.schema.get_strv(pref)[0];

			if (!originalValue) {
				button.set_label(_('Disabled'));
			}
			else {
				button.set_label(originalValue);
			}
		};

		const startEditing = () => {
			button.isEditing = button.label;
			button.set_label(_('Enter shortcut'));
		};

		const revertEditing = () => {
			button.set_label(button.isEditing);
			button.isEditing = null;
		};

		const stopEditing = () => {
			setLabelFromSettings();
			button.isEditing = null;
		};

		setLabelFromSettings();

		button.connect('clicked', () => {
			if (button.isEditing) {
				revertEditing();
				return;
			}

			startEditing();

			const eventController = new Gtk.EventControllerKey();
			button.add_controller(eventController);

			let debounceTimeoutId = null;
			const connectId = eventController.connect('key-pressed', (_ec, keyval, keycode, mask) => {
				if (debounceTimeoutId) clearTimeout(debounceTimeoutId);

				mask = mask & Gtk.accelerator_get_default_mod_mask();

				if (mask === 0) {
					switch (keyval) {
						case Gdk.KEY_Escape:
							revertEditing();
							return Gdk.EVENT_STOP;
						case Gdk.KEY_BackSpace:
							this.schema.set_strv(pref, []);
							setLabelFromSettings();
							stopEditing();
							eventController.disconnect(connectId);
							return Gdk.EVENT_STOP;
					}
				}

				const selectedShortcut = Gtk.accelerator_name_with_keycode(
					null,
					keyval,
					keycode,
					mask
				);

				debounceTimeoutId = setTimeout(() => {
					eventController.disconnect(connectId);
					this.schema.set_strv(pref, [selectedShortcut]);
					stopEditing();
				}, 400);

				return Gdk.EVENT_STOP;
			});

			button.show();
		});

		return button;
	}
}
