import { WorkspaceLeaf, ItemView, Notice, TFile, Setting } from 'obsidian';

export const VIEW_TYPE_WIKI_MAKER = 'azure-devops-wiki-maker';

interface WikiFile {
    id: number;
    title: string;
    filePath: string;
    isParent: boolean;
    selected: boolean;
    content: string;
    exists: boolean;
}

export class WikiMakerView extends ItemView {
    plugin: any;
    private availableFiles: WikiFile[] = [];
    private parentNode: any = null;
    private contentTextArea: HTMLTextAreaElement | null = null;
    private filenameInput: HTMLInputElement | null = null;
    private fileSelectionContainer: HTMLElement | null = null;
    private filesInitialized: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: any) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_WIKI_MAKER;
    }

    getDisplayText(): string {
        return 'Wiki Maker';
    }

    getIcon(): string {
        return 'file-text';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.createEl('h2', { text: 'Wiki Maker' });

        if (!this.parentNode) {
            this.showNoDataMessage(container);
            return;
        }

        await this.buildWikiMakerInterface(container);
    }

    private showNoDataMessage(container: Element) {
        const messageContainer = container.createDiv({ cls: 'wiki-maker-no-data' });
        
        messageContainer.createEl('h3', { text: '📝 Wiki Maker' });
        messageContainer.createEl('p', { 
            text: 'Right-click on a work item in the Azure DevOps Tree view and select "Create Wiki Note" to get started.' 
        });
        
        const instructions = messageContainer.createDiv({ cls: 'wiki-maker-instructions' });
        instructions.createEl('h4', { text: 'How to use:' });
        const list = instructions.createEl('ul');
        list.createEl('li', { text: 'Open the Azure DevOps Tree view' });
        list.createEl('li', { text: 'Pull work items from Azure DevOps' });
        list.createEl('li', { text: 'Right-click on any work item' });
        list.createEl('li', { text: 'Select "Create Wiki Note"' });
        list.createEl('li', { text: 'The Wiki Maker will open with the selected work item and its children' });
    }

    async loadWorkItemData(parentNode: any) {
        this.parentNode = parentNode;
        this.availableFiles = [];
        
        console.log('WikiMakerView: Loading work item data for:', {
            id: parentNode.id,
            title: parentNode.title,
            filePath: parentNode.filePath,
            hasChildren: !!parentNode.children,
            childrenCount: parentNode.children?.length || 0
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

        // Add children files
        if (parentNode.children && parentNode.children.length > 0) {
            for (const child of parentNode.children) {
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
            }
        }

        this.filesInitialized = true;
        console.log('WikiMakerView: Loaded', this.availableFiles.length, 'files');

        // Refresh the view
        this.onOpen();
    }

    private async loadFileContent(filePath: string): Promise<{content: string, exists: boolean}> {
        if (!filePath) {
            return {content: '', exists: false};
        }

        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                const extractedContent = this.extractDescriptionFromNote(content);
                return {
                    content: extractedContent,
                    exists: true
                };
            }
        } catch (error) {
            console.warn(`WikiMakerView: Could not read file: ${filePath}`, error);
        }
        return {content: '', exists: false};
    }

    private extractDescriptionFromNote(content: string): string {
        if (!content) return '';
        
        if (!content.includes('## Description')) {
            return '';
        }
        
        const patterns = [
            /## Description\n\n([\s\S]*?)(?=\n## (?:Custom Fields|Links))/,
            /## Description\n([\s\S]*?)(?=\n## (?:Custom Fields|Links))/,
            /## Description\s*\n\s*([\s\S]*?)(?=\n## |---|\*Last|$)/,
            /## Description[\s\S]*?\n([\s\S]*?)(?=\n---|\*Last|$)/
        ];
        
        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
                let description = match[1].trim();
                description = description.replace(/\n---\s*$/, '').trim();
                description = description.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
                
                if (description.length > 0) {
                    return description;
                }
            }
        }
        
        return '';
    }

    private async buildWikiMakerInterface(container: Element) {
        // Main layout container
        const mainContainer = container.createDiv({ cls: 'wiki-maker-main-container' });
        
        // Left panel - File selection and settings
        const leftPanel = mainContainer.createDiv({ cls: 'wiki-maker-left-panel' });
        this.createFileSelectionSection(leftPanel);
        this.createFilenameSection(leftPanel);
        this.createActionButtons(leftPanel);

        // Right panel - Content preview/edit
        const rightPanel = mainContainer.createDiv({ cls: 'wiki-maker-right-panel' });
        this.createContentSection(rightPanel);

        this.addCustomStyles();
        this.updatePreview();
    }

    private createFileSelectionSection(container: Element) {
        const section = container.createDiv({ cls: 'wiki-maker-file-selection' });
        section.createEl('h3', { text: 'Select Files to Include' });

        const fileCount = section.createEl('p', {
            text: `Found ${this.availableFiles.length} files (${this.availableFiles.filter(f => f.isParent).length} parent, ${this.availableFiles.filter(f => !f.isParent).length} children)`,
            cls: 'wiki-maker-file-count'
        });

        this.fileSelectionContainer = section.createDiv({ cls: 'wiki-maker-file-list' });

        if (this.availableFiles.length === 0) {
            const noFiles = this.fileSelectionContainer.createDiv({ cls: 'wiki-maker-no-files' });
            noFiles.innerHTML = `
                <p><strong>⚠️ No files found</strong></p>
                <p>Make sure you have pulled work items from Azure DevOps and the selected work item has an associated file.</p>
            `;
            return;
        }

        for (const file of this.availableFiles) {
            const fileItem = this.fileSelectionContainer.createDiv({ cls: 'wiki-maker-file-item' });
            
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

            if (!file.exists) {
                const warning = fileItem.createEl('div', { cls: 'wiki-maker-file-warning' });
                warning.textContent = '⚠️ File does not exist - may need to pull work items first';
            } else if (!file.content) {
                const warning = fileItem.createEl('div', { cls: 'wiki-maker-file-warning' });
                warning.textContent = '⚠️ No description found in this file';
            } else {
                const success = fileItem.createEl('div', { cls: 'wiki-maker-file-success' });
                success.textContent = `✅ Description found (${file.content.length} characters)`;
            }
        }
    }

    private createFilenameSection(container: Element) {
        const section = container.createDiv({ cls: 'wiki-maker-filename-section' });
        
        new Setting(section)
            .setName('Wiki Note Filename')
            .setDesc('Name for the wiki note (without .md extension)')
            .addText(text => {
                this.filenameInput = text.inputEl;
                text.setValue(this.sanitizeFileName(this.parentNode?.title || 'wiki-note'))
                    .setPlaceholder('my-wiki-note');
            });
    }

    private createActionButtons(container: Element) {
        const buttonContainer = container.createDiv({ cls: 'wiki-maker-actions' });
        
        const refreshBtn = buttonContainer.createEl('button', {
            text: '🔄 Refresh Files',
            cls: 'mod-secondary'
        });
        refreshBtn.onclick = async () => {
            if (this.parentNode) {
                await this.loadWorkItemData(this.parentNode);
            }
        };

        const selectAllBtn = buttonContainer.createEl('button', {
            text: '☑️ Select All',
            cls: 'mod-secondary'
        });
        selectAllBtn.onclick = () => {
            this.availableFiles.forEach(file => file.selected = true);
            this.refreshFileSelection();
            this.updatePreview();
        };

        const selectNoneBtn = buttonContainer.createEl('button', {
            text: '❌ Select None', 
            cls: 'mod-secondary'
        });
        selectNoneBtn.onclick = () => {
            this.availableFiles.forEach(file => file.selected = false);
            this.refreshFileSelection();
            this.updatePreview();
        };

        const createBtn = buttonContainer.createEl('button', {
            text: '📝 Create Wiki Note',
            cls: 'mod-cta'
        });
        createBtn.onclick = async () => {
            await this.createWikiNote();
        };
    }

    private createContentSection(container: Element) {
        const section = container.createDiv({ cls: 'wiki-maker-content-section' });
        section.createEl('h3', { text: 'Content Preview' });
        
        const description = section.createEl('p', { 
            text: 'Edit the generated markdown content as needed',
            cls: 'wiki-maker-content-description'
        });

        this.contentTextArea = section.createEl('textarea', {
            cls: 'wiki-maker-content-editor'
        });
        this.contentTextArea.placeholder = 'Generated content will appear here...';
        
        // Add keyboard shortcuts
        this.contentTextArea.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                this.createWikiNote();
            }
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.createWikiNote();
            }
        });
    }

    private updatePreview() {
        if (!this.contentTextArea) return;

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

            // Add children content
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

        this.contentTextArea.value = markdown;
    }

    private refreshFileSelection() {
        if (!this.fileSelectionContainer) return;
        
        // Clear and rebuild the file selection
        this.fileSelectionContainer.empty();
        
        if (this.availableFiles.length === 0) {
            const noFiles = this.fileSelectionContainer.createDiv({ cls: 'wiki-maker-no-files' });
            noFiles.innerHTML = `
                <p><strong>⚠️ No files found</strong></p>
                <p>Make sure you have pulled work items from Azure DevOps and the selected work item has an associated file.</p>
            `;
            return;
        }

        for (const file of this.availableFiles) {
            const fileItem = this.fileSelectionContainer.createDiv({ cls: 'wiki-maker-file-item' });
            
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

            if (!file.exists) {
                const warning = fileItem.createEl('div', { cls: 'wiki-maker-file-warning' });
                warning.textContent = '⚠️ File does not exist - may need to pull work items first';
            } else if (!file.content) {
                const warning = fileItem.createEl('div', { cls: 'wiki-maker-file-warning' });
                warning.textContent = '⚠️ No description found in this file';
            } else {
                const success = fileItem.createEl('div', { cls: 'wiki-maker-file-success' });
                success.textContent = `✅ Description found (${file.content.length} characters)`;
            }
        }
    }

    private async createWikiNote() {
        const filename = this.filenameInput?.value.trim() || 'wiki-note';
        const content = this.contentTextArea?.value || '';

        if (!content.trim()) {
            new Notice('❌ Content cannot be empty');
            return;
        }

        try {
            await this.plugin.workItemManager.saveWikiNote(content, filename);
            new Notice(`✅ Wiki note "${filename}" created successfully`);
        } catch (error) {
            new Notice(`❌ Error creating wiki note: ${error.message}`);
            console.error('Wiki note creation error:', error);
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
        if (!document.querySelector('#wiki-maker-view-styles')) {
            const style = document.createElement('style');
            style.id = 'wiki-maker-view-styles';
            style.textContent = `
                .wiki-maker-main-container {
                    display: flex;
                    height: calc(100vh - 100px);
                    gap: 16px;
                    padding: 16px;
                }

                .wiki-maker-left-panel {
                    flex: 0 0 400px;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    overflow-y: auto;
                    border-right: 1px solid var(--background-modifier-border);
                    padding-right: 16px;
                }

                .wiki-maker-right-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }

                .wiki-maker-file-selection {
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 8px;
                    padding: 16px;
                    background: var(--background-secondary);
                }

                .wiki-maker-file-list {
                    max-height: 300px;
                    overflow-y: auto;
                    margin-top: 12px;
                }

                .wiki-maker-file-item {
                    padding: 8px 0;
                    border-bottom: 1px solid var(--background-modifier-border-hover);
                }

                .wiki-maker-file-item:last-child {
                    border-bottom: none;
                }

                .wiki-maker-file-item label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: pointer;
                    font-family: var(--font-monospace);
                    font-size: 0.9em;
                    line-height: 1.4;
                }

                .wiki-maker-file-warning {
                    margin-left: 20px;
                    color: var(--text-error);
                    font-size: 0.8em;
                    font-style: italic;
                    margin-top: 4px;
                }

                .wiki-maker-file-success {
                    margin-left: 20px;
                    color: var(--text-success);
                    font-size: 0.8em;
                    margin-top: 4px;
                }

                .wiki-maker-file-count {
                    font-size: 0.85em;
                    color: var(--text-muted);
                    margin: 0;
                    font-family: var(--font-monospace);
                }

                .wiki-maker-filename-section {
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 8px;
                    padding: 16px;
                    background: var(--background-secondary);
                }

                .wiki-maker-actions {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                }

                .wiki-maker-content-section {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }

                .wiki-maker-content-description {
                    color: var(--text-muted);
                    font-size: 0.9em;
                    margin: 0 0 12px 0;
                }

                .wiki-maker-content-editor {
                    flex: 1;
                    width: 100%;
                    padding: 16px;
                    font-family: var(--font-monospace);
                    font-size: 13px;
                    line-height: 1.5;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 6px;
                    background: var(--background-primary);
                    color: var(--text-normal);
                    resize: none;
                    min-height: 400px;
                }

                .wiki-maker-content-editor:focus {
                    outline: none;
                    border-color: var(--interactive-accent);
                    box-shadow: 0 0 0 2px var(--interactive-accent-hover);
                }

                .wiki-maker-no-data {
                    padding: 40px;
                    text-align: center;
                    color: var(--text-muted);
                }

                .wiki-maker-instructions {
                    margin-top: 20px;
                    text-align: left;
                    background: var(--background-secondary);
                    padding: 16px;
                    border-radius: 8px;
                    border-left: 4px solid var(--interactive-accent);
                }

                .wiki-maker-no-files {
                    padding: 20px;
                    color: var(--text-muted);
                    background: var(--background-secondary);
                    border-radius: 6px;
                    border-left: 4px solid var(--text-warning);
                }

                @media (max-width: 768px) {
                    .wiki-maker-main-container {
                        flex-direction: column;
                        height: auto;
                    }
                    
                    .wiki-maker-left-panel {
                        flex: none;
                        border-right: none;
                        border-bottom: 1px solid var(--background-modifier-border);
                        padding-right: 0;
                        padding-bottom: 16px;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    async onClose() {
        const { containerEl } = this;
        containerEl.empty();
    }
}