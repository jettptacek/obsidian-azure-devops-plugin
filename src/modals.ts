import { Modal, Notice, Setting } from 'obsidian';
import { WorkItem } from './settings';

// Modal for creating work items
export class WorkItemModal extends Modal {
    plugin: any; // Main plugin instance
    workItem: WorkItem;

    constructor(app: any, plugin: any) {
        super(app);
        this.plugin = plugin;
        this.workItem = {
            title: '',
            description: '',
            workItemType: 'Task'
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Create Azure DevOps Work Item' });

        new Setting(contentEl)
            .setName('Title')
            .setDesc('Work item title')
            .addText(text => text
                .setPlaceholder('Enter title')
                .setValue(this.workItem.title)
                .onChange(async (value) => {
                    this.workItem.title = value;
                }));

        new Setting(contentEl)
            .setName('Type')
            .setDesc('Work item type')
            .addDropdown(dropdown => dropdown
                .addOption('Task', 'Task')
                .addOption('Bug', 'Bug')
                .addOption('User Story', 'User Story')
                .addOption('Feature', 'Feature')
                .addOption('Epic', 'Epic')
                .addOption('Issue', 'Issue')
                .setValue(this.workItem.workItemType)
                .onChange(async (value) => {
                    this.workItem.workItemType = value;
                }));

        new Setting(contentEl)
            .setName('Description')
            .setDesc('Work item description')
            .addTextArea(text => text
                .setPlaceholder('Enter description')
                .setValue(this.workItem.description)
                .onChange(async (value) => {
                    this.workItem.description = value;
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Create Work Item')
                .setCta()
                .onClick(async () => {
                    if (!this.workItem.title) {
                        new Notice('Title is required');
                        return;
                    }
                    await this.plugin.createWorkItem(this.workItem);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}