import { Plugin, Notice, WorkspaceLeaf, TFile } from 'obsidian';
import { AzureDevOpsSettings, DEFAULT_SETTINGS } from './settings';
import { AzureDevOpsTreeView, VIEW_TYPE_AZURE_DEVOPS_TREE } from './tree-view';
import { WorkItemModal } from './modals';
import { AzureDevOpsSettingTab } from './settings-tab';
import { AzureDevOpsAPI } from './api';
import { WorkItemManager } from './work-item-manager';
import { MenuManager } from './menu-manager';
import { AzureDevOpsLinkValidator } from './link-validator'; // ADD THIS IMPORT

export default class AzureDevOpsPlugin extends Plugin {
    settings: AzureDevOpsSettings;
    api: AzureDevOpsAPI;
    workItemManager: WorkItemManager;
    menuManager: MenuManager;
    linkValidator: AzureDevOpsLinkValidator; // ADD THIS PROPERTY

    async onload() {
        await this.loadSettings();

        // Initialize managers
        this.api = new AzureDevOpsAPI(this.settings);
        this.workItemManager = new WorkItemManager(this.app, this.api, this.settings, this);
        this.menuManager = new MenuManager(this.app, this.workItemManager);
        this.linkValidator = new AzureDevOpsLinkValidator(this.app, this.api, this.settings, this); // ADD THIS LINE

        // Register the tree view
        this.registerView(
            VIEW_TYPE_AZURE_DEVOPS_TREE,
            (leaf) => new AzureDevOpsTreeView(leaf, this)
        );

        // Add ribbon icons
        this.addRibbonIcon('create-new', 'Create Azure DevOps Work Item', () => {
            if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
                new Notice('❌ Please configure Azure DevOps settings first');
                return;
            }
            new WorkItemModal(this.app, this).open();
        });

        this.addRibbonIcon('git-branch', 'Azure DevOps Tree View', () => {
            this.activateTreeView();
        });

        // ADD THIS NEW RIBBON ICON FOR LINK VALIDATION
        this.addRibbonIcon('link', 'Validate Azure DevOps Links', () => {
            if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
                new Notice('❌ Please configure Azure DevOps settings first');
                return;
            }
            this.linkValidator.validateAllAzureDevOpsLinks();
        });

        // Add commands
        this.addCommand({
            id: 'create-azure-devops-work-item',
            name: 'Create Azure DevOps Work Item',
            callback: () => {
                if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
                    new Notice('❌ Please configure Azure DevOps settings first');
                    return;
                }
                new WorkItemModal(this.app, this).open();
            }
        });

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

        // ADD THIS NEW COMMAND FOR LINK VALIDATION
        this.addCommand({
            id: 'validate-azure-devops-links',
            name: 'Validate Azure DevOps Links in Descriptions',
            callback: () => {
                if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
                    new Notice('❌ Please configure Azure DevOps settings first');
                    return;
                }
                this.linkValidator.validateAllAzureDevOpsLinks();
            }
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
        // ADD THIS TO UPDATE LINK VALIDATOR SETTINGS
        if (this.linkValidator) {
            this.linkValidator.settings = this.settings;
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
        // ADD THIS TO UPDATE LINK VALIDATOR SETTINGS
        if (this.linkValidator) {
            this.linkValidator.settings = this.settings;
        }
    }

    // ENHANCED: Create Azure DevOps work item with better integration
    async createWorkItem(workItem: any): Promise<any> {
        try {
            // Validate the work item data
            const validation = this.api.validateWorkItemData(workItem);
            if (!validation.isValid) {
                new Notice(`❌ Validation failed: ${validation.errors.join(', ')}`);
                return { success: false, errors: validation.errors };
            }

            // Create the work item in Azure DevOps
            const result = await this.api.createWorkItem(workItem);
            
            if (result) {
                // Always create a note for the new work item
                await this.createNoteForWorkItem(result);
                
                // FIXED: Proper type casting for tree view
                const leaves = this.app.workspace.getLeavesOfType('azure-devops-tree-view');
                if (leaves.length > 0) {
                    const treeView = leaves[0].view;
                    
                    // Type-safe check and cast to your specific tree view class
                    if (treeView.getViewType() === 'azure-devops-tree-view') {
                        const azureTreeView = treeView as any; // Cast to bypass TypeScript
                        
                        if (typeof azureTreeView.addNewWorkItemToTree === 'function') {
                            // Use optimized add method
                            await azureTreeView.addNewWorkItemToTree(result);
                        } else {
                            // Fallback to full refresh if optimized method doesn't exist
                            this.refreshTreeView();
                        }
                    } else {
                        // Fallback if not the right view type
                        this.refreshTreeView();
                    }
                } else {
                    // No tree view open, no need to refresh
                    console.log('No tree view open, skipping tree update');
                }
                
                // Navigate to the new work item in tree view if possible
                if (result.id && this.workItemManager) {
                    setTimeout(() => {
                        this.workItemManager.navigateToWorkItemInTree(result.id);
                    }, 500); // Reduced delay since no full refresh
                }
                
                return {
                    id: result.id,
                    url: `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_workitems/edit/${result.id}`,
                    success: true
                };
            }
            
            return { success: false, error: 'Failed to create work item' };
            
        } catch (error) {
            console.error('Error creating work item:', error);
            return { 
                success: false, 
                error: error.message || 'Unknown error occurred'
            };
        }
    }

    // NEW: Create note for newly created work item
    async createNoteForWorkItem(workItem: any): Promise<void> {
        try {
            const noteContent = await this.workItemManager.createWorkItemNote(workItem);
            const safeTitle = this.workItemManager.sanitizeFileName(workItem.fields['System.Title']);
            const filename = `WI-${workItem.id} ${safeTitle}.md`;
            const folderPath = 'Azure DevOps Work Items';
            const fullPath = `${folderPath}/${filename}`;

            // Ensure folder exists
            if (!await this.app.vault.adapter.exists(folderPath)) {
                await this.app.vault.createFolder(folderPath);
            }

            // Create the note
            await this.app.vault.create(fullPath, noteContent);
            console.log(`Created note for new work item: ${filename}`);
        } catch (error) {
            console.error('Error creating note for work item:', error);
            // Don't throw error here - note creation failure shouldn't fail work item creation
        }
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

    async pushSpecificWorkItem(file: TFile) {
        const result = await this.workItemManager.pushSpecificWorkItem(file);
        return result;
    }

    async pullSpecificWorkItem(file: TFile) {
        const result = await this.workItemManager.pullSpecificWorkItem(file);
        return result;
    }

    sanitizeFileName(title: string): string {
        return this.workItemManager.sanitizeFileName(title);
    }

    // ADD THIS NEW METHOD TO EXPOSE LINK VALIDATION FUNCTIONALITY
    async validateAzureDevOpsLinks(): Promise<void> {
        return this.linkValidator.validateAllAzureDevOpsLinks();
    }
}