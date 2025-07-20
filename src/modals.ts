import { Modal, Notice, Setting, DropdownComponent } from 'obsidian';
import { WorkItem } from './settings';

// Modal for creating work items with dynamic type loading
export class WorkItemModal extends Modal {
    plugin: any; // Main plugin instance
    workItem: WorkItem;
    private workItemTypes: any[] = [];
    private isLoadingTypes: boolean = false;
    private typeDropdown: DropdownComponent | null = null;

    constructor(app: any, plugin: any) {
        super(app);
        this.plugin = plugin;
        this.workItem = {
            title: '',
            description: '',
            workItemType: 'Task' // Default fallback
        };
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Create Azure DevOps Work Item' });

        // Show loading message while fetching work item types
        const loadingEl = contentEl.createEl('p', { 
            text: '🔄 Loading work item types from Azure DevOps...',
            cls: 'loading-message'
        });

        try {
            // Load work item types from Azure DevOps
            await this.loadWorkItemTypes();
            loadingEl.remove();
            this.buildForm();
        } catch (error) {
            loadingEl.remove();
            console.error('Error loading work item types:', error);
            
            // Show error and fall back to default types
            const errorEl = contentEl.createEl('p', {
                text: '⚠️ Could not load work item types from Azure DevOps. Using default types.',
                cls: 'error-message'
            });
            errorEl.style.color = 'var(--text-error)';
            errorEl.style.marginBottom = '16px';
            
            this.setDefaultWorkItemTypes();
            this.buildForm();
        }
    }

    private async loadWorkItemTypes() {
        this.isLoadingTypes = true;
        
        try {
            // Get work item types from the API
            this.workItemTypes = await this.plugin.api.getWorkItemTypes();
            
            // Filter to only include types that can be created (not read-only system types)
            this.workItemTypes = this.workItemTypes.filter(type => {
                // Filter out disabled types or system types that shouldn't be created manually
                return !type.isDisabled && 
                       !type.name.includes('Test Suite') && 
                       !type.name.includes('Test Plan') &&
                       !type.name.includes('Shared Steps') &&
                       !type.name.includes('Code Review');
            });

            // Sort by common types first, then alphabetically
            const commonTypes = ['Epic', 'Feature', 'User Story', 'Task', 'Bug', 'Issue'];
            this.workItemTypes.sort((a, b) => {
                const aIndex = commonTypes.indexOf(a.name);
                const bIndex = commonTypes.indexOf(b.name);
                
                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                } else if (aIndex !== -1) {
                    return -1;
                } else if (bIndex !== -1) {
                    return 1;
                } else {
                    return a.name.localeCompare(b.name);
                }
            });

            // Set default to the first available type (or Task if available)
            if (this.workItemTypes.length > 0) {
                const taskType = this.workItemTypes.find(type => type.name === 'Task');
                this.workItem.workItemType = taskType ? taskType.name : this.workItemTypes[0].name;
            }

            console.log(`Loaded ${this.workItemTypes.length} work item types:`, 
                       this.workItemTypes.map(t => t.name));
            
        } catch (error) {
            console.error('Failed to load work item types:', error);
            throw error;
        } finally {
            this.isLoadingTypes = false;
        }
    }

    private setDefaultWorkItemTypes() {
        // Fallback to default types if API call fails
        this.workItemTypes = [
            { name: 'Epic', description: 'Large feature or initiative' },
            { name: 'Feature', description: 'A feature or capability' },
            { name: 'User Story', description: 'A user story or requirement' },
            { name: 'Task', description: 'A task or work item' },
            { name: 'Bug', description: 'A bug or defect' },
            { name: 'Issue', description: 'An issue or problem' }
        ];
        this.workItem.workItemType = 'Task';
    }

    private buildForm() {
        const { contentEl } = this;

        // Title setting
        new Setting(contentEl)
            .setName('Title')
            .setDesc('Work item title (required)')
            .addText(text => text
                .setPlaceholder('Enter a descriptive title')
                .setValue(this.workItem.title)
                .onChange(async (value) => {
                    this.workItem.title = value;
                }));

        // Work item type setting with dynamic types
        const typeSetting = new Setting(contentEl)
            .setName('Type')
            .setDesc('Work item type');

        if (this.workItemTypes.length > 0) {
            typeSetting.addDropdown(dropdown => {
                this.typeDropdown = dropdown;
                
                // Add all available work item types
                this.workItemTypes.forEach(type => {
                    dropdown.addOption(type.name, type.name);
                });
                
                dropdown
                    .setValue(this.workItem.workItemType)
                    .onChange(async (value) => {
                        this.workItem.workItemType = value;
                        this.updateTypeDescription(value);
                    });
                
                return dropdown;
            });

            // Add description for the selected type
            this.updateTypeDescription(this.workItem.workItemType);
        } else {
            typeSetting.setDesc('No work item types available');
        }

        // Description setting
        new Setting(contentEl)
            .setName('Description')
            .setDesc('Work item description (optional)')
            .addTextArea(text => {
                text
                    .setPlaceholder('Enter a detailed description of the work item')
                    .setValue(this.workItem.description)
                    .onChange(async (value) => {
                        this.workItem.description = value;
                    });
                
                // Make the text area larger
                text.inputEl.rows = 4;
                text.inputEl.style.minHeight = '100px';
                text.inputEl.style.resize = 'vertical';
                
                return text;
            });

        // Action buttons
        const buttonContainer = contentEl.createDiv();
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '8px';
        buttonContainer.style.marginTop = '20px';
        buttonContainer.style.justifyContent = 'flex-end';

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-secondary'
        });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        // Create button
        const createBtn = buttonContainer.createEl('button', {
            text: 'Create Work Item',
            cls: 'mod-cta'
        });
        createBtn.addEventListener('click', async () => {
            await this.handleCreateWorkItem();
        });

        // Add some styling
        this.addCustomStyles();
    }

    private updateTypeDescription(typeName: string) {
        const { contentEl } = this;
        
        // Remove existing type description
        const existingDesc = contentEl.querySelector('.type-description');
        if (existingDesc) {
            existingDesc.remove();
        }

        // Find the selected type
        const selectedType = this.workItemTypes.find(type => type.name === typeName);
        if (selectedType && selectedType.description) {
            // Add type description below the dropdown
            const typeSettingEl = contentEl.querySelector('.setting-item:nth-child(3)'); // Type is the 2nd setting
            if (typeSettingEl) {
                const descEl = document.createElement('div');
                descEl.className = 'type-description';
                descEl.style.fontSize = '12px';
                descEl.style.color = 'var(--text-muted)';
                descEl.style.marginTop = '4px';
                descEl.style.fontStyle = 'italic';
                descEl.textContent = `💡 ${selectedType.description}`;
                
                typeSettingEl.appendChild(descEl);
            }
        }
    }

    private async handleCreateWorkItem() {
        // Validate required fields
        if (!this.workItem.title || this.workItem.title.trim() === '') {
            new Notice('❌ Title is required');
            return;
        }

        if (!this.workItem.workItemType) {
            new Notice('❌ Work item type is required');
            return;
        }

        // Show loading state
        const createBtn = this.contentEl.querySelector('.mod-cta') as HTMLButtonElement;
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = 'Creating...';
        }

        try {
            // Create the work item
            const result = await this.plugin.createWorkItem(this.workItem);
            
            if (result) {
                new Notice(`✅ Created ${this.workItem.workItemType}: ${this.workItem.title}`);
                this.close();
                
                // Optional: Navigate to the created work item in tree view if it exists
                if (result.id && this.plugin.workItemManager) {
                    setTimeout(() => {
                        this.plugin.workItemManager.navigateToWorkItemInTree(result.id);
                    }, 1000); // Small delay to allow for tree refresh
                }
            } else {
                new Notice('❌ Failed to create work item');
            }
        } catch (error) {
            console.error('Error creating work item:', error);
            new Notice(`❌ Error creating work item: ${error.message}`);
        } finally {
            // Restore button state
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = 'Create Work Item';
            }
        }
    }

    private addCustomStyles() {
        // Add some custom styles to improve the modal appearance
        if (!document.querySelector('#work-item-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'work-item-modal-styles';
            style.textContent = `
                .loading-message {
                    text-align: center;
                    color: var(--text-muted);
                    font-style: italic;
                    margin: 20px 0;
                }
                
                .error-message {
                    padding: 8px 12px;
                    background-color: var(--background-modifier-error);
                    border-radius: 4px;
                    border-left: 4px solid var(--text-error);
                }
                
                .type-description {
                    background-color: var(--background-secondary);
                    padding: 6px 8px;
                    border-radius: 4px;
                    border-left: 3px solid var(--interactive-accent);
                }
                
                .modal-content {
                    max-width: 500px;
                }
                
                .setting-item-description {
                    margin-bottom: 8px;
                }
            `;
            document.head.appendChild(style);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Optional: Enhanced work item creation result interface
export interface WorkItemCreationResult {
    id?: number;
    url?: string;
    success: boolean;
    error?: string;
}