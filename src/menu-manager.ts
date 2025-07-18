import { App, Notice, TFile } from 'obsidian';
import { WorkItemManager } from './work-item-manager';

export class MenuManager {
    app: App;
    workItemManager: WorkItemManager;

    constructor(app: App, workItemManager: WorkItemManager) {
        this.app = app;
        this.workItemManager = workItemManager;
    }

    // Helper method to add Azure DevOps menu items
    addAzureDevOpsMenuItems(menu: any, file: any) {
        if (file instanceof TFile && file.extension === 'md') {
            // Add the menu items immediately for all markdown files
            // Check if it's a work item when clicked
            menu.addItem((item: any) => {
                item
                    .setTitle('Push to Azure DevOps')
                    .setIcon('upload')
                    .onClick(async () => {
                        // Check if it's a work item when clicked
                        const content = await this.app.vault.read(file);
                        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                        if (!frontmatterMatch) {
                            new Notice('This note doesn\'t have frontmatter. Only work item notes can be pushed.');
                            return;
                        }

                        const frontmatter = frontmatterMatch[1];
                        const idMatch = frontmatter.match(/id:\s*(\d+)/);
                        
                        if (!idMatch) {
                            new Notice('This note doesn\'t have a work item ID. Only pulled work items can be pushed.');
                            return;
                        }
                        
                        await this.workItemManager.pushSpecificWorkItem(file);
                    });
            });

            menu.addItem((item: any) => {
                item
                    .setTitle('Pull from Azure DevOps')
                    .setIcon('download')
                    .onClick(async () => {
                        // Check if it's a work item when clicked
                        const content = await this.app.vault.read(file);
                        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                        if (!frontmatterMatch) {
                            new Notice('This note doesn\'t have frontmatter. Only work item notes can be pulled.');
                            return;
                        }

                        const frontmatter = frontmatterMatch[1];
                        const idMatch = frontmatter.match(/id:\s*(\d+)/);
                        
                        if (!idMatch) {
                            new Notice('This note doesn\'t have a work item ID. Only work item notes can be pulled.');
                            return;
                        }
                        
                        await this.workItemManager.pullSpecificWorkItem(file);
                    });
            });
        }
    }
}