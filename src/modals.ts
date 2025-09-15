import { Modal, Notice, Setting, DropdownComponent, App, TFile } from 'obsidian';
import { WorkItem, WorkItemType } from './settings';

interface AzureDevOpsPlugin {
    app: App;
    api: {
        getWorkItemTypes(): Promise<WorkItemType[]>;
    };
    workItemManager?: {
        navigateToWorkItemInTree(id: number): void;
    };
    createWorkItem(workItem: WorkItem): Promise<{ id: number; success: boolean }>;
}

// Modal for creating work items with dynamic type loading
export class WorkItemModal extends Modal {
    plugin: AzureDevOpsPlugin;
    workItem: WorkItem;
    private workItemTypes: WorkItemType[] = [];
    private isLoadingTypes: boolean = false;
    private typeDropdown: DropdownComponent | null = null;

    constructor(app: App, plugin: AzureDevOpsPlugin) {
        super(app);
        this.plugin = plugin;
        this.workItem = {
            title: '',
            description: '',
            workItemType: 'Task'
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
            errorEl.classList.add('azure-modal-error-message');
            
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
                text.inputEl.classList.add('azure-modal-description-textarea');
                
                return text;
            });

        // Action buttons
        const buttonContainer = contentEl.createDiv();
        buttonContainer.classList.add('azure-modal-button-container');

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-secondary'
        });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        const createBtn = buttonContainer.createEl('button', {
            text: 'Create Work Item',
            cls: 'mod-cta'
        });
        createBtn.addEventListener('click', async () => {
            await this.handleCreateWorkItem();
        });

        this.addCustomStyles();
    }

    private updateTypeDescription(typeName: string) {
        const { contentEl } = this;
        
        const existingDesc = contentEl.querySelector('.type-description');
        if (existingDesc) {
            existingDesc.remove();
        }

        const selectedType = this.workItemTypes.find(type => type.name === typeName);
        if (selectedType && selectedType.description) {

            const typeSettingEl = contentEl.querySelector('.setting-item:nth-child(3)'); // Type is the 2nd setting
            if (typeSettingEl) {
                const descEl = document.createElement('div');
                descEl.className = 'type-description';
                descEl.classList.add('azure-modal-type-description');
                descEl.textContent = `💡 ${selectedType.description}`;
                
                typeSettingEl.appendChild(descEl);
            }
        }
    }

    private async handleCreateWorkItem() {

        if (!this.workItem.title || this.workItem.title.trim() === '') {
            new Notice('❌ Title is required');
            return;
        }

        if (!this.workItem.workItemType) {
            new Notice('❌ Work item type is required');
            return;
        }

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
                
 
                if (result.id && this.plugin.workItemManager) {
                    setTimeout(() => {
                        this.plugin.workItemManager?.navigateToWorkItemInTree(result.id);
                    }, 1000);
                }
            } else {
                new Notice('❌ Failed to create work item');
            }
        } catch (error) {
            console.error('Error creating work item:', error);
            new Notice(`❌ Error creating work item: ${error.message}`);
        } finally {

            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = 'Create Work Item';
            }
        }
    }

    private addCustomStyles() {

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

export interface WorkItemCreationResult {
    id?: number;
    url?: string;
    success: boolean;
    error?: string;
}

interface WikiFile {
    id: number;
    title: string;
    filePath: string;
    isParent: boolean;
    selected: boolean;
    content: string;
    exists: boolean;
}

export class WikiPreviewModal extends Modal {
    private workItemTitle: string;
    private onConfirm: (content: string, filename: string) => Promise<void>;
    private contentTextArea: HTMLTextAreaElement | null = null;
    private filenameInput: HTMLInputElement | null = null;
    private fileSelectionContainer: HTMLElement | null = null;
    private availableFiles: WikiFile[] = [];
    private parentNode: any;
    private filesInitialized: boolean = false;
    
    constructor(app: App, parentNode: any, onConfirm: (content: string, filename: string) => Promise<void>) {
        super(app);
        this.workItemTitle = parentNode.title;
        this.onConfirm = onConfirm;
        this.parentNode = parentNode;
    }
    
    private async initializeFiles(parentNode: any) {
        console.log('WikiPreviewModal: Initializing files for parent node:', {
            id: parentNode.id,
            title: parentNode.title,
            filePath: parentNode.filePath,
            hasChildren: !!parentNode.children,
            childrenCount: parentNode.children?.length || 0,
            childrenIds: parentNode.children?.map((c: any) => c.id) || []
        });
        
        // Add parent file
        const parentContent = await this.loadFileContent(parentNode.filePath);
        this.availableFiles.push({
            id: parentNode.id,
            title: parentNode.title,
            filePath: parentNode.filePath || '',
            isParent: true,
            selected: true,
            content: parentContent.content,
            exists: parentContent.exists
        });
        
        console.log('WikiPreviewModal: Parent file loaded:', {
            exists: parentContent.exists,
            contentLength: parentContent.content.length,
            filePath: parentNode.filePath
        });
        
        // Add children files
        if (parentNode.children && parentNode.children.length > 0) {
            console.log('WikiPreviewModal: Processing', parentNode.children.length, 'children');
            for (const child of parentNode.children) {
                console.log('WikiPreviewModal: Processing child:', {
                    id: child.id,
                    title: child.title,
                    filePath: child.filePath
                });
                
                const childContent = await this.loadFileContent(child.filePath);
                this.availableFiles.push({
                    id: child.id,
                    title: child.title,
                    filePath: child.filePath || '',
                    isParent: false,
                    selected: true,
                    content: childContent.content,
                    exists: childContent.exists
                });
                
                console.log('WikiPreviewModal: Child file loaded:', {
                    id: child.id,
                    exists: childContent.exists,
                    contentLength: childContent.content.length
                });
            }
        } else {
            console.log('WikiPreviewModal: No children found for parent node');
        }
        
        console.log('WikiPreviewModal: Total files initialized:', this.availableFiles.length);
    }
    
    private async loadFileContent(filePath: string): Promise<{content: string, exists: boolean}> {
        console.log('WikiPreviewModal: Loading file content for:', filePath);
        
        if (!filePath) {
            console.log('WikiPreviewModal: No filePath provided');
            return {content: '', exists: false};
        }
        
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            console.log('WikiPreviewModal: File object:', !!file, file?.path);
            
            if (file instanceof TFile) {
                console.log('WikiPreviewModal: File is TFile, reading content...');
                const content = await this.app.vault.read(file);
                console.log('WikiPreviewModal: Raw content length:', content.length);
                
                const extractedContent = this.extractDescriptionFromNote(content);
                console.log('WikiPreviewModal: Extracted content length:', extractedContent.length);
                
                return {
                    content: extractedContent,
                    exists: true
                };
            } else {
                console.log('WikiPreviewModal: File is not a TFile instance');
            }
        } catch (error) {
            console.warn(`WikiPreviewModal: Could not read file: ${filePath}`, error);
        }
        return {content: '', exists: false};
    }
    
    private extractDescriptionFromNote(content: string): string {
        if (!content) {
            console.log('WikiPreviewModal: No content provided to extract description from');
            return '';
        }
        
        console.log('WikiPreviewModal: Extracting description from content (first 300 chars):', content.substring(0, 300));
        
        // Check if content contains "## Description" at all
        if (!content.includes('## Description')) {
            console.log('WikiPreviewModal: Content does not contain "## Description" section');
            return '';
        }
        
        // Multiple regex patterns to handle different formatting variations
        const patterns = [
            // Standard format: ## Description\n\n followed by content until next section
            /## Description\n\n([\s\S]*?)(?=\n## (?:Custom Fields|Links))/,
            // With single newline: ## Description\n followed by content
            /## Description\n([\s\S]*?)(?=\n## (?:Custom Fields|Links))/,
            // More flexible: ## Description with optional whitespace
            /## Description\s*\n\s*([\s\S]*?)(?=\n## |---|\*Last|$)/,
            // Catch all: everything after ## Description until end or next major section
            /## Description[\s\S]*?\n([\s\S]*?)(?=\n---|\*Last|$)/
        ];
        
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const match = content.match(pattern);
            console.log(`WikiPreviewModal: Pattern ${i + 1} match:`, !!match, match?.[1]?.substring(0, 100));
            
            if (match && match[1]) {
                let description = match[1].trim();
                // Clean up common artifacts
                description = description.replace(/\n---\s*$/, '').trim();
                description = description.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
                
                if (description.length > 0) {
                    console.log('WikiPreviewModal: Successfully extracted description (length:', description.length, ')');
                    return description;
                }
            }
        }
        
        console.log('WikiPreviewModal: No description could be extracted with any pattern');
        return '';
    }
    
    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Create Wiki Note' });
        
        // Show loading message
        const loadingEl = contentEl.createEl('p', { 
            text: '🔄 Loading files from work items...',
            cls: 'wiki-loading-message'
        });
        
        try {
            // Initialize files properly
            await this.initializeFiles(this.parentNode);
            this.filesInitialized = true;
            
            // Remove loading message
            loadingEl.remove();
            
            // Build the UI
            this.buildUI(contentEl);
            
        } catch (error) {
            console.error('WikiPreviewModal: Error initializing files:', error);
            loadingEl.remove();
            
            // Show error message
            const errorEl = contentEl.createEl('p', {
                text: '❌ Failed to load files. Please try again.',
                cls: 'wiki-error-message'
            });
            
            // Add retry button
            const retryBtn = contentEl.createEl('button', {
                text: 'Retry',
                cls: 'mod-cta'
            });
            retryBtn.onclick = () => {
                this.onOpen();
            };
        }
    }
    
    private buildUI(contentEl: HTMLElement) {
        // Add explanatory text
        const description = contentEl.createEl('p', { cls: 'wiki-preview-description' });
        description.textContent = 'Select files to include and preview the generated wiki note content.';
        
        // Filename section (above the two-column layout)
        this.createFilenameSection(contentEl);
        
        // Create main container with two columns
        const mainContainer = contentEl.createDiv({ cls: 'wiki-main-container' });
        
        // Left column - File selection
        const leftColumn = mainContainer.createDiv({ cls: 'wiki-left-column' });
        this.createFileSelectionSection(leftColumn);
        
        // Right column - Content preview/edit
        const rightColumn = mainContainer.createDiv({ cls: 'wiki-right-column' });
        this.createContentSection(rightColumn);
        
        // Buttons
        this.createButtons(contentEl);
        
        this.addCustomStyles();
        this.updatePreview();
    }
    
    private createFileSelectionSection(contentEl: HTMLElement) {
        const section = contentEl.createDiv({ cls: 'wiki-file-selection-section' });
        section.createEl('h3', { text: 'Select Files to Include' });
        
        // Debug info section
        const debugInfo = section.createDiv({ cls: 'wiki-debug-info' });
        debugInfo.createEl('p', { 
            text: `Found ${this.availableFiles.length} files total (${this.availableFiles.filter(f => f.isParent).length} parent, ${this.availableFiles.filter(f => !f.isParent).length} children)`,
            cls: 'wiki-debug-text'
        });
        
        this.fileSelectionContainer = section.createDiv({ cls: 'wiki-file-selection-container' });
        
        if (this.availableFiles.length === 0) {
            const noFiles = this.fileSelectionContainer.createDiv({ cls: 'wiki-no-files' });
            noFiles.innerHTML = `
                <p><strong>⚠️ No files found</strong></p>
                <p>Possible reasons:</p>
                <ul>
                    <li>Work items haven't been pulled from Azure DevOps yet</li>
                    <li>The selected work item doesn't have an associated file</li>
                    <li>The tree view data is still loading</li>
                </ul>
                <p><em>Try pulling work items first, then select a work item that has a file.</em></p>
            `;
            return;
        }
        
        for (const file of this.availableFiles) {
            const fileItem = this.fileSelectionContainer.createDiv({ cls: 'wiki-file-item' });
            
            const checkbox = fileItem.createEl('input', { type: 'checkbox' });
            checkbox.checked = file.selected;
            checkbox.addEventListener('change', () => {
                file.selected = checkbox.checked;
                this.updatePreview();
            });
            
            const label = fileItem.createEl('label');
            const statusIcon = file.isParent ? '📋' : '📄';
            const statusText = file.isParent ? 'Parent' : 'Child';
            const contentStatus = file.content ? '✅' : '❌';
            const existsStatus = file.exists ? '' : ' (File not found)';
            
            label.innerHTML = `${statusIcon} <strong>[${file.id}]</strong> ${file.title} <em>(${statusText})</em> ${contentStatus}${existsStatus}`;
            label.prepend(checkbox);
            
            // Debug file path
            const debugPath = fileItem.createEl('div', { cls: 'wiki-file-debug' });
            debugPath.textContent = `Path: ${file.filePath || 'No path'}`;
            
            if (!file.exists) {
                const warning = fileItem.createEl('div', { cls: 'wiki-file-warning' });
                warning.textContent = '⚠️ File does not exist - may need to pull work items first';
            } else if (!file.content) {
                const warning = fileItem.createEl('div', { cls: 'wiki-file-warning' });
                warning.textContent = '⚠️ No description found in this file';
            } else {
                const success = fileItem.createEl('div', { cls: 'wiki-file-success' });
                success.textContent = `✅ Description found (${file.content.length} characters)`;
            }
        }
    }
    
    private createFilenameSection(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName('Filename')
            .setDesc('Name for the wiki note (without .md extension)')
            .addText(text => {
                this.filenameInput = text.inputEl;
                text.setValue(this.sanitizeFileName(this.workItemTitle))
                    .setPlaceholder('my-wiki-note');
            });
    }
    
    private createContentSection(contentEl: HTMLElement) {
        const header = contentEl.createEl('h3', { text: 'Content Preview' });
        header.style.marginTop = '0';
        header.style.marginBottom = '10px';
        
        const description = contentEl.createEl('p', { 
            text: 'Edit the generated markdown content as needed',
            cls: 'wiki-content-description'
        });
        
        const editorContainer = contentEl.createDiv({ cls: 'wiki-preview-editor-container' });
        this.contentTextArea = editorContainer.createEl('textarea', {
            cls: 'wiki-preview-editor'
        });
        this.contentTextArea.rows = 20;
        this.contentTextArea.placeholder = 'Generated content will appear here...';
    }
    
    private createButtons(contentEl: HTMLElement) {
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        
        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-secondary'
        });
        cancelBtn.onclick = () => this.close();
        
        const createBtn = buttonContainer.createEl('button', {
            text: 'Create Wiki Note',
            cls: 'mod-cta'
        });
        createBtn.onclick = async () => {
            const filename = this.filenameInput?.value.trim() || 'wiki-note';
            const content = this.contentTextArea?.value || '';
            
            if (!content.trim()) {
                new Notice('❌ Content cannot be empty');
                return;
            }
            
            createBtn.disabled = true;
            createBtn.textContent = 'Creating...';
            
            try {
                await this.onConfirm(content, filename);
                this.close();
            } catch (error) {
                new Notice(`❌ Error creating wiki note: ${error.message}`);
            } finally {
                createBtn.disabled = false;
                createBtn.textContent = 'Create Wiki Note';
            }
        };
        
        // Add keyboard shortcuts
        this.contentTextArea?.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                createBtn.click();
            }
        });
    }
    
    private updatePreview() {
        let markdown = '';
        const selectedFiles = this.availableFiles.filter(f => f.selected);
        const parentFiles = selectedFiles.filter(f => f.isParent);
        const childFiles = selectedFiles.filter(f => !f.isParent);
        
        if (selectedFiles.length === 0) {
            markdown = '# No files selected\n\nPlease select at least one file to include in the wiki note.';
        } else {
            // Add parent content
            if (parentFiles.length > 0) {
                const parent = parentFiles[0];
                markdown += `# ${parent.title}\n\n`;
                if (parent.content) {
                    markdown += `${parent.content}\n\n`;
                } else {
                    markdown += `*No description available for this work item.*\n\n`;
                }
            }
            
            // Add children content (without "Child Items" header, using ## for titles)
            if (childFiles.length > 0) {
                for (const child of childFiles) {
                    markdown += `## ${child.title}\n\n`;
                    if (child.content) {
                        markdown += `${child.content}\n\n`;
                    } else {
                        markdown += `*No description available for this work item.*\n\n`;
                    }
                }
            }
        }
        
        if (this.contentTextArea) {
            this.contentTextArea.value = markdown;
        }
    }
    
    private sanitizeFileName(title: string): string {
        return title
            .replace(/[<>:"/\\|?*]/g, '-')
            .replace(/\s+/g, '-')
            .toLowerCase()
            .substring(0, 50);
    }
    
    private addCustomStyles() {
        if (!document.querySelector('#wiki-preview-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'wiki-preview-modal-styles';
            style.textContent = `
                .modal {
                    --modal-width: 90vw;
                    --modal-height: 90vh;
                    max-width: 1600px;
                }
                
                .wiki-preview-description {
                    color: var(--text-muted);
                    font-size: 0.9em;
                    margin-bottom: 20px;
                }
                
                .wiki-main-container {
                    display: flex;
                    gap: 20px;
                    height: 65vh;
                    margin: 20px 0;
                }
                
                .wiki-left-column {
                    flex: 0 0 35%;
                    min-width: 350px;
                }
                
                .wiki-right-column {
                    flex: 1;
                    min-width: 500px;
                }
                
                .wiki-file-selection-section {
                    height: 100%;
                    padding: 15px;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 8px;
                    background: var(--background-secondary);
                    display: flex;
                    flex-direction: column;
                }
                
                .wiki-file-selection-container {
                    flex: 1;
                    overflow-y: auto;
                    border: 1px solid var(--background-modifier-border-hover);
                    border-radius: 4px;
                    padding: 8px;
                    background: var(--background-primary);
                    margin-top: 10px;
                }
                
                .wiki-file-item {
                    padding: 8px 0;
                    border-bottom: 1px solid var(--background-modifier-border-hover);
                }
                
                .wiki-file-item:last-child {
                    border-bottom: none;
                }
                
                .wiki-file-item label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: pointer;
                    font-family: var(--font-monospace);
                    font-size: 0.9em;
                    line-height: 1.4;
                }
                
                .wiki-debug-info {
                    background: var(--background-primary-alt);
                    padding: 8px;
                    border-radius: 4px;
                    margin-bottom: 10px;
                }
                
                .wiki-debug-text {
                    font-size: 0.85em;
                    color: var(--text-muted);
                    margin: 0;
                    font-family: var(--font-monospace);
                }
                
                .wiki-loading-message {
                    text-align: center;
                    color: var(--text-muted);
                    font-style: italic;
                    margin: 20px 0;
                    font-size: 14px;
                }
                
                .wiki-error-message {
                    text-align: center;
                    color: var(--text-error);
                    margin: 20px 0;
                    font-weight: 500;
                }
                
                .wiki-no-files {
                    padding: 20px;
                    color: var(--text-muted);
                    background: var(--background-secondary);
                    border-radius: 6px;
                    border-left: 4px solid var(--text-warning);
                }
                
                .wiki-no-files p {
                    margin: 8px 0;
                }
                
                .wiki-no-files ul {
                    margin: 8px 0;
                    padding-left: 20px;
                }
                
                .wiki-no-files li {
                    margin: 4px 0;
                }
                
                .wiki-file-debug {
                    margin-left: 20px;
                    color: var(--text-muted);
                    font-size: 0.75em;
                    font-family: var(--font-monospace);
                    margin-top: 2px;
                }
                
                .wiki-file-warning {
                    margin-left: 20px;
                    color: var(--text-error);
                    font-size: 0.8em;
                    font-style: italic;
                    margin-top: 4px;
                }
                
                .wiki-file-success {
                    margin-left: 20px;
                    color: var(--text-success);
                    font-size: 0.8em;
                    margin-top: 4px;
                }
                
                .wiki-content-description {
                    color: var(--text-muted);
                    font-size: 0.9em;
                    margin: 0 0 10px 0;
                }
                
                .wiki-preview-editor-container {
                    width: 100%;
                    height: calc(100% - 80px);
                    display: flex;
                    flex-direction: column;
                }
                
                .wiki-preview-editor {
                    width: 100%;
                    height: 100%;
                    min-height: 400px;
                    padding: 12px;
                    font-family: var(--font-monospace);
                    font-size: 13px;
                    line-height: 1.5;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 6px;
                    background: var(--background-primary);
                    color: var(--text-normal);
                    resize: none;
                    flex: 1;
                }
                
                .wiki-preview-editor:focus {
                    outline: none;
                    border-color: var(--interactive-accent);
                    box-shadow: 0 0 0 2px var(--interactive-accent-hover);
                }
                
                .modal-button-container {
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 1px solid var(--background-modifier-border);
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