import { PluginSettingTab, Setting } from 'obsidian';

export class AzureDevOpsSettingTab extends PluginSettingTab {
    plugin: any;

    constructor(app: any, plugin: any) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Azure DevOps Settings' });

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
            .setName('Personal Access Token')
            .setDesc('Azure DevOps Personal Access Token with work item permissions')
            .addText(text => text
                .setPlaceholder('your-pat-token')
                .setValue(this.plugin.settings.personalAccessToken)
                .onChange(async (value) => {
                    this.plugin.settings.personalAccessToken = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Use Markdown in Azure DevOps')
            .setDesc('Enable native Markdown support in Azure DevOps (recommended for new work items). Note: Once enabled for a work item, it cannot be reverted to HTML.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useMarkdownInAzureDevOps)
                .onChange(async (value) => {
                    this.plugin.settings.useMarkdownInAzureDevOps = value;
                    await this.plugin.saveSettings();
                }));

    }
}