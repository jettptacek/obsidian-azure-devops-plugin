import { App, PluginSettingTab, Setting } from 'obsidian';
import type AzureDevOpsPlugin from './main';

export class AzureDevOpsSettingTab extends PluginSettingTab {
    plugin: AzureDevOpsPlugin;

    constructor(app: App, plugin: AzureDevOpsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Organization')
            .setDesc('Azure DevOps organization name (just the name, not the full URL)')
            .addText(text => text
                .setPlaceholder('your-org')
                .setValue(this.plugin.settings.organization)
                .onChange(async (value) => {
                    this.plugin.settings.organization = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Project')
            .setDesc('Azure DevOps project name')
            .addText(text => text
                .setPlaceholder('your-project')
                .setValue(this.plugin.settings.project)
                .onChange(async (value) => {
                    this.plugin.settings.project = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Personal access token')
            .setDesc('Azure DevOps Personal Access Token with work item permissions')
            .addText(text => text
                .setPlaceholder('your-pat-token')
                .setValue(this.plugin.settings.personalAccessToken)
                .onChange(async (value) => {
                    this.plugin.settings.personalAccessToken = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Markdown inuse in Azure DevOps')
            .setDesc('Push and Pull with no html conversion')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useMarkdownInAzureDevOps)
                .onChange(async (value) => {
                    this.plugin.settings.useMarkdownInAzureDevOps = value;
                    await this.plugin.saveSettings();
                }));

    }
}