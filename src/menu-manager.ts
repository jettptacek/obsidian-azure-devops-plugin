import { App, Notice, TFile } from 'obsidian';
import { WorkItemManager } from './work-item-manager';

export class MenuManager {
    app: App;
    workItemManager: WorkItemManager;

    constructor(app: App, workItemManager: WorkItemManager) {
        this.app = app;
        this.workItemManager = workItemManager;
    }

    private async checkWorkItemFile(file: TFile): Promise<number | null> {
        try {
            const content = await this.app.vault.read(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) {
                return null;
            }

            const frontmatter = frontmatterMatch[1];
            const idMatch = frontmatter.match(/id:\s*(\d+)/);
            
            return idMatch ? parseInt(idMatch[1]) : null;
        } catch (error) {
            return null;
        }
    }

    addAzureDevOpsMenuItems(menu: any, file: any) {
        if (file instanceof TFile && file.extension === 'md') {

            menu.addItem((item: any) => {
                item
                    .setTitle('Focus in Tree')
                    .setIcon('focus')
                    .onClick(async () => {
                        const workItemId = await this.checkWorkItemFile(file);
                        if (!workItemId) {
                            new Notice('This note doesn\'t have a work item ID. Only work item notes can be focused in tree.');
                            return;
                        }
                        
                        await this.workItemManager.navigateToWorkItemInTree(workItemId, true);
                    });
            });

            menu.addSeparator();

            menu.addItem((item: any) => {
                item
                    .setTitle('Push to Azure DevOps')
                    .setIcon('upload')
                    .onClick(async () => {
                        const workItemId = await this.checkWorkItemFile(file);
                        if (!workItemId) {
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
                        const workItemId = await this.checkWorkItemFile(file);
                        if (!workItemId) {
                            new Notice('This note doesn\'t have a work item ID. Only work item notes can be pulled.');
                            return;
                        }
                        
                        await this.workItemManager.pullSpecificWorkItem(file);
                    });
            });

            menu.addItem((item: any) => {
                item
                    .setTitle('View in Azure DevOps')
                    .setIcon('external-link')
                    .onClick(async () => {
                        const workItemId = await this.checkWorkItemFile(file);
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