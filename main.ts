import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import { AzureDevOpsSettings, DEFAULT_SETTINGS } from './settings';
import { AzureDevOpsTreeView, VIEW_TYPE_AZURE_DEVOPS_TREE } from './tree-view';
import { WorkItemModal } from './modals';
import { AzureDevOpsSettingTab } from './settings-tab';
import { AzureDevOpsAPI } from './api';
import { WorkItemManager } from './work-item-manager';
import { MenuManager } from './menu-manager';

export default class AzureDevOpsPlugin extends Plugin {
    settings: AzureDevOpsSettings;
    api: AzureDevOpsAPI;
    workItemManager: WorkItemManager;
    menuManager: MenuManager;

    async onload() {
        await this.loadSettings();

        // Initialize managers
        this.api = new AzureDevOpsAPI(this.settings);
        this.workItemManager = new WorkItemManager(this.app, this.api, this.settings);
        this.menuManager = new MenuManager(this.app, this.workItemManager);

        // Register the tree view
        this.registerView(
            VIEW_TYPE_AZURE_DEVOPS_TREE,
            (leaf) => new AzureDevOpsTreeView(leaf, this)
        );

        // Add ribbon icons
        this.addRibbonIcon('external-link', 'Azure DevOps', () => {
            new WorkItemModal(this.app, this).open();
        });

        this.addRibbonIcon('git-branch', 'Azure DevOps Tree View', () => {
            this.activateTreeView();
        });

        // Add commands
        this.addCommand({
            id: 'open-azure-devops-tree',
            name: 'Open Azure DevOps Tree View',
            callback: () => this.activateTreeView()
        });

        this.addCommand({
            id: 'pull-work-items',
            name: 'Pull Work Items from Azure DevOps',
            callback: () => this.workItemManager.pullWorkItems()
        });

        this.addCommand({
            id: 'push-work-item',
            name: 'Push Work Item to Azure DevOps',
            callback: () => this.workItemManager.pushCurrentWorkItem()
        });

        // Register context menu handlers
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                this.menuManager.addAzureDevOpsMenuItems(menu, file);
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (view.file) {
                    this.menuManager.addAzureDevOpsMenuItems(menu, view.file);
                }
            })
        );

        // Add settings tab
        this.addSettingTab(new AzureDevOpsSettingTab(this.app, this));
    }

    async activateTreeView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_AZURE_DEVOPS_TREE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            await leaf?.setViewState({ type: VIEW_TYPE_AZURE_DEVOPS_TREE, active: true });
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        
        // Update API settings when settings change
        if (this.api) {
            this.api.updateSettings(this.settings);
        }
        if (this.workItemManager) {
            this.workItemManager.updateSettings(this.settings);
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
        
        // Update API settings when settings change
        if (this.api) {
            this.api.updateSettings(this.settings);
        }
        if (this.workItemManager) {
            this.workItemManager.updateSettings(this.settings);
        }
    }

    // Create Azure DevOps work item
    async createWorkItem(workItem: { title: string; description: string; workItemType: string; }): Promise<any> {
        const result = await this.api.createWorkItem(workItem);
        if (result) {
            this.refreshTreeView();
        }
        return result;
    }

    // Refresh tree view if it's open
    refreshTreeView() {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AZURE_DEVOPS_TREE);
        leaves.forEach(leaf => {
            // Type-safe check and cast
            if (leaf.view.getViewType() === VIEW_TYPE_AZURE_DEVOPS_TREE) {
                const treeView = leaf.view as AzureDevOpsTreeView;
                treeView.refreshTreeView();
            }
        });
    }

    // Delegate methods to managers
    async getWorkItemsWithRelations(): Promise<any[]> {
        return this.api.getWorkItemsWithRelations();
    }

    async pushSpecificWorkItem(file: any) {
        const result = await this.workItemManager.pushSpecificWorkItem(file);
        if (result) {
            this.refreshTreeView();
        }
        return result;
    }

    async pullSpecificWorkItem(file: any) {
        const result = await this.workItemManager.pullSpecificWorkItem(file);
        if (result) {
            this.refreshTreeView();
        }
        return result;
    }

    sanitizeFileName(title: string): string {
        return this.workItemManager.sanitizeFileName(title);
    }
}