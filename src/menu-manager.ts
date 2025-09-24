import { App, Notice, TFile, Menu, MenuItem } from 'obsidian';
import { WorkItemManager } from './work-item-manager';

export class MenuManager {
    app: App;
    workItemManager: WorkItemManager;

    constructor(app: App, workItemManager: WorkItemManager) {
        this.app = app;
        this.workItemManager = workItemManager;
    }

    private checkWorkItemFile(file: TFile): number | null {
        try {
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!frontmatter) {
                return null;
            }

            if('id' in frontmatter)
            {
               return frontmatter.id; 
            }
            return null;

        } catch (error) {
            console.error('CheckworkItem Error',error);
            return null;
        }
    }

    addAzureDevOpsMenuItems(menu: Menu, file: TFile) {
        if (file instanceof TFile && file.extension === 'md') {

            menu.addItem((item: MenuItem) => {
                item
                    .setTitle('Focus in tree')
                    .setIcon('focus')
                    .onClick(async () => {
                        const workItemId = this.checkWorkItemFile(file);
                        if (!workItemId) {
                            new Notice('This note doesn\'t have a work item ID. Only work item notes can be focused in tree.');
                            return;
                        }
                        
                        await this.workItemManager.navigateToWorkItemInTree(workItemId, true);
                    });
            });

            menu.addSeparator();

            menu.addItem((item: MenuItem) => {
                item
                    .setTitle('Push to Azure DevOps')
                    .setIcon('upload')
                    .onClick(async () => {
                        const workItemId = this.checkWorkItemFile(file);
                        if (!workItemId) {
                            new Notice('This note doesn\'t have a work item ID. Only pulled work items can be pushed.');
                            return;
                        }
                        
                        await this.workItemManager.pushSpecificWorkItem(file);
                    });
            });

            menu.addItem((item: MenuItem) => {
                item
                    .setTitle('Pull from Azure DevOps')
                    .setIcon('download')
                    .onClick(async () => {
                        const workItemId = this.checkWorkItemFile(file);
                        if (!workItemId) {
                            new Notice('This note doesn\'t have a work item ID. Only work item notes can be pulled.');
                            return;
                        }
                        
                        await this.workItemManager.pullSpecificWorkItem(file);
                    });
            });

            menu.addItem((item: MenuItem) => {
                item
                    .setTitle('View in Azure DevOps')
                    .setIcon('external-link')
                    .onClick(async () => {
                        const workItemId = this.checkWorkItemFile(file);
                        if (!workItemId) {
                            new Notice('This note doesn\'t have a work item ID. Only work item notes can be opened in Azure DevOps.');
                            return;
                        }
                        
                        const url = `https://dev.azure.com/${this.workItemManager.settings.organization}/${encodeURIComponent(this.workItemManager.settings.project)}/_workitems/edit/${workItemId}`;
                        window.open(url, '_blank');
                    });
            });
        }
    }
}