import { WorkspaceLeaf, ItemView, Notice, TFile, Setting } from 'obsidian';

export const VIEW_TYPE_WIKI_MAKER = 'azure-devops-wiki-maker';

interface WikiFile {
    id: number;
    title: string;
    filePath: string;
    selected: boolean;
    content: string;
    exists: boolean;
    order: number;
}

export class WikiMakerView extends ItemView {
    plugin: any;
    private availableFiles: WikiFile[] = [];
    private workItems: any[] = [];
    private contentTextArea: HTMLTextAreaElement | null = null;
    private filenameInput: HTMLInputElement | null = null;
    private fileSelectionContainer: HTMLElement | null = null;
    private filesInitialized: boolean = false;
    private dropZoneInitialized: boolean = false;

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
        container.createEl('h2', { text: 'Description Collector' });

        // Set up drop zone only once on the main container
        if (!this.dropZoneInitialized) {
            this.setupDropZone(this.containerEl);
            this.dropZoneInitialized = true;
        }

        if (this.availableFiles.length === 0) {
            this.showNoDataMessage(container);
            return;
        }

        await this.buildWikiMakerInterface(container);
    }

    private showNoDataMessage(container: Element) {
        const messageContainer = container.createDiv({ cls: 'wiki-maker-no-data wiki-maker-drop-zone' });
        
        messageContainer.createEl('h3', { text: '📝 Wiki Maker' });
        messageContainer.createEl('p', { 
            text: 'Drag a work item from the Azure DevOps Tree view here to create a wiki note.' 
        });
        
        const instructions = messageContainer.createDiv({ cls: 'wiki-maker-instructions' });
        instructions.createEl('h4', { text: 'How to use:' });
        const list = instructions.createEl('ul');
        list.createEl('li', { text: 'Open the Azure DevOps Tree view' });
        list.createEl('li', { text: 'Pull work items from Azure DevOps' });
        list.createEl('li', { text: 'Drag any work item from the tree view' });
        list.createEl('li', { text: 'Drop it into this Wiki Maker view' });
        list.createEl('li', { text: 'The Wiki Maker will load the selected work item' });
        
        // Drop zone is set up on the main container
    }

    async loadWorkItemData(initialNode: any) {
        this.availableFiles = [];
        
        console.log('WikiMakerView: Loading work item data for:', {
            id: initialNode.id,
            title: initialNode.title,
            filePath: initialNode.filePath
        });

        // Add initial work item
        await this.addWorkItemToList(initialNode, 0);

        this.filesInitialized = true;
        console.log('WikiMakerView: Loaded', this.availableFiles.length, 'files');

        // Refresh the view
        this.onOpen();
    }

    async addWorkItemToList(workItem: any, order?: number) {
        const content = await this.loadFileContent(workItem.filePath);
        const newOrder = order !== undefined ? order : this.availableFiles.length;
        
        this.availableFiles.push({
            id: workItem.id,
            title: workItem.title,
            filePath: workItem.filePath || '',
            selected: true,
            content: content.content,
            exists: content.exists,
            order: newOrder
        });

        // Sort by order
        this.availableFiles.sort((a, b) => a.order - b.order);
        this.refreshFileSelection();
        this.updatePreview();
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



        this.fileSelectionContainer = section.createDiv({ cls: 'wiki-maker-file-list' });

        if (this.availableFiles.length === 0) {
            const noFiles = this.fileSelectionContainer.createDiv({ cls: 'wiki-maker-no-files' });
            noFiles.innerHTML = `
                <p><strong>⚠️ No files found</strong></p>
                <p>Make sure you have pulled work items from Azure DevOps and the selected work item has an associated file.</p>
            `;
            return;
        }

        this.renderFileList();
    }

    private renderFileList() {
        if (!this.fileSelectionContainer) return;
        
        this.availableFiles.forEach((file, index) => {
            const fileItem = this.fileSelectionContainer!.createDiv({ cls: 'wiki-maker-file-item' });
            fileItem.dataset.fileId = file.id.toString();
            
            // Drag handle for reordering
            const dragHandle = fileItem.createEl('span', { cls: 'wiki-maker-drag-handle' });
            dragHandle.textContent = '⋮⋮';
            dragHandle.title = 'Drag to reorder';
            
            // Checkbox
            const checkbox = fileItem.createEl('input', { type: 'checkbox' });
            checkbox.checked = file.selected;
            checkbox.addEventListener('change', () => {
                file.selected = checkbox.checked;
                this.updatePreview();
            });

            // Content container
            const contentContainer = fileItem.createDiv({ cls: 'wiki-maker-file-content' });
            
            const label = contentContainer.createEl('label');
            const statusIcon = '📄';
            const existsStatus = file.exists ? '' : ' (File not found)';

            label.innerHTML = `${statusIcon} <strong>[${file.id}]</strong> ${file.title}${existsStatus}`;
            label.prepend(checkbox);

            // Status message
            if (!file.exists) {
                const warning = contentContainer.createEl('div', { cls: 'wiki-maker-file-warning' });
                warning.textContent = '⚠️ File does not exist - may need to pull work items first';
            } else if (!file.content) {
                const warning = contentContainer.createEl('div', { cls: 'wiki-maker-file-warning' });
                warning.textContent = '⚠️ No description found in this file';
            }

            // Control buttons
            const controls = fileItem.createDiv({ cls: 'wiki-maker-file-controls' });
            
            // Move up button
            if (index > 0) {
                const moveUpBtn = controls.createEl('button', { cls: 'wiki-maker-control-btn' });
                moveUpBtn.textContent = '↑';
                moveUpBtn.title = 'Move up';
                moveUpBtn.onclick = () => this.moveFile(index, index - 1);
            }
            
            // Move down button
            if (index < this.availableFiles.length - 1) {
                const moveDownBtn = controls.createEl('button', { cls: 'wiki-maker-control-btn' });
                moveDownBtn.textContent = '↓';
                moveDownBtn.title = 'Move down';
                moveDownBtn.onclick = () => this.moveFile(index, index + 1);
            }
            
            // Remove button
            const removeBtn = controls.createEl('button', { cls: 'wiki-maker-control-btn wiki-maker-remove-btn' });
            removeBtn.textContent = '✕';
            removeBtn.title = 'Remove from list';
            removeBtn.onclick = () => this.removeFile(index);

            // Add drag and drop functionality
            this.setupFileDragAndDrop(fileItem, index);
        });
    }

    private moveFile(fromIndex: number, toIndex: number) {
        if (fromIndex < 0 || fromIndex >= this.availableFiles.length || 
            toIndex < 0 || toIndex >= this.availableFiles.length) {
            return;
        }

        const [movedFile] = this.availableFiles.splice(fromIndex, 1);
        this.availableFiles.splice(toIndex, 0, movedFile);

        // Update order values
        this.availableFiles.forEach((file, index) => {
            file.order = index;
        });

        this.refreshFileSelection();
        this.updatePreview();
    }

    private removeFile(index: number) {
        if (index < 0 || index >= this.availableFiles.length) {
            return;
        }

        const removedFile = this.availableFiles[index];
        this.availableFiles.splice(index, 1);

        // Update order values
        this.availableFiles.forEach((file, idx) => {
            file.order = idx;
        });

        this.refreshFileSelection();
        this.updatePreview();

        new Notice(`Removed [${removedFile.id}] ${removedFile.title} from list`);
    }

    private setupFileDragAndDrop(fileItem: HTMLElement, index: number) {
        fileItem.draggable = true;
        
        fileItem.addEventListener('dragstart', (e: DragEvent) => {
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', index.toString());
            }
            fileItem.classList.add('wiki-maker-file-dragging');
        });

        fileItem.addEventListener('dragend', () => {
            fileItem.classList.remove('wiki-maker-file-dragging');
            this.removeAllDropIndicators();
        });

        fileItem.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            this.showDropIndicator(fileItem, true);
        });

        fileItem.addEventListener('dragleave', () => {
            this.showDropIndicator(fileItem, false);
        });

        fileItem.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            this.showDropIndicator(fileItem, false);
            
            const draggedIndex = parseInt(e.dataTransfer?.getData('text/plain') || '-1');
            if (draggedIndex !== -1 && draggedIndex !== index) {
                this.moveFile(draggedIndex, index);
            }
        });
    }

    private showDropIndicator(element: HTMLElement, show: boolean) {
        if (show) {
            element.classList.add('wiki-maker-file-drop-target');
        } else {
            element.classList.remove('wiki-maker-file-drop-target');
        }
    }

    private removeAllDropIndicators() {
        const items = this.fileSelectionContainer?.querySelectorAll('.wiki-maker-file-item') || [];
        items.forEach(item => {
            (item as HTMLElement).classList.remove('wiki-maker-file-drop-target');
        });
    }

    private createFilenameSection(container: Element) {
        const section = container.createDiv({ cls: 'wiki-maker-filename-section' });
        
        new Setting(section)
            .setName('Wiki Note Filename')
            .setDesc('Name for the wiki note (without .md extension)')
            .addText(text => {
                this.filenameInput = text.inputEl;
                text.setValue(this.sanitizeFileName(this.availableFiles[0]?.title || 'wiki-note'))
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
            // Refresh all loaded work items
            for (const file of this.availableFiles) {
                const content = await this.loadFileContent(file.filePath);
                file.content = content.content;
                file.exists = content.exists;
            }
            this.refreshFileSelection();
            this.updatePreview();
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
            text: '📝 Create File',
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

        if (selectedFiles.length === 0) {
            markdown = '# No work items selected\n\nPlease select at least one work item to include in the wiki note.';
        } else {

            // Add each selected work item as a section
            for (const file of selectedFiles) {
                
                markdown += `# ${file.title}\n\n`;
                if (file.content) {
                    markdown += `${file.content}\n\n`;
                } else {
                    markdown += `*No description available for this work item.*\n\n`;
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
                <p><strong>⚠️ No work items found</strong></p>
                <p>Drag work items from the Azure DevOps tree view to add them to this list.</p>
            `;
            return;
        }

        this.renderFileList();
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

    private setupDropZone(container: Element) {
        let dragCounter = 0;
        
        container.addEventListener('dragenter', (e: DragEvent) => {
            e.preventDefault();
            dragCounter++;
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
            container.classList.add('wiki-maker-drop-zone--active');
        });

        container.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        container.addEventListener('dragleave', (e: DragEvent) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter === 0) {
                container.classList.remove('wiki-maker-drop-zone--active');
            }
        });

        container.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            dragCounter = 0;
            container.classList.remove('wiki-maker-drop-zone--active');
            
            // Check for multiple nodes first
            const multiNodeData = e.dataTransfer?.getData('application/x-workitem-nodes');
            if (multiNodeData) {
                await this.handleMultipleWorkItemsDrop(JSON.parse(multiNodeData));
                return;
            }
            
            // Fall back to single node
            const workItemId = e.dataTransfer?.getData('text/plain');
            if (workItemId) {
                await this.handleWorkItemDrop(parseInt(workItemId));
            }
        });
    }

    private async handleWorkItemDrop(workItemId: number) {
        const treeViewLeaf = this.app.workspace.getLeavesOfType('azure-devops-tree-view')[0];
        if (!treeViewLeaf?.view) {
            new Notice('❌ Could not find Azure DevOps tree view');
            return;
        }

        const treeView = treeViewLeaf.view as any;
        if (!treeView.allNodes || typeof treeView.allNodes.get !== 'function') {
            new Notice('❌ Tree view not properly loaded');
            return;
        }

        const node = treeView.allNodes.get(workItemId);
        if (!node) {
            new Notice(`❌ Work item ${workItemId} not found in tree`);
            return;
        }

        // Check if this work item is already in the list
        const existingIndex = this.availableFiles.findIndex(file => file.id === node.id);
        if (existingIndex !== -1) {
            new Notice(`⚠️ Work item [${node.id}] ${node.title} is already in the list`);
            return;
        }

        new Notice(`📝 Adding [${node.id}] ${node.title} to wiki maker...`);
        
        // If this is the first item, initialize the view
        if (this.availableFiles.length === 0) {
            await this.loadWorkItemData(node);
        } else {
            // Just add the new item to the existing list
            await this.addWorkItemToList(node);
        }
    }

    private async handleMultipleWorkItemsDrop(workItemsData: any[]) {
        if (!workItemsData || workItemsData.length === 0) {
            new Notice('❌ No work items to add');
            return;
        }

        const treeViewLeaf = this.app.workspace.getLeavesOfType('azure-devops-tree-view')[0];
        if (!treeViewLeaf?.view) {
            new Notice('❌ Could not find Azure DevOps tree view');
            return;
        }

        const treeView = treeViewLeaf.view as any;
        if (!treeView.allNodes || typeof treeView.allNodes.get !== 'function') {
            new Notice('❌ Tree view not properly loaded');
            return;
        }

        let addedCount = 0;
        let skippedCount = 0;
        let firstItem = true;

        for (const workItemData of workItemsData) {
            const node = treeView.allNodes.get(workItemData.id);
            if (!node) {
                console.warn(`Work item ${workItemData.id} not found in tree`);
                continue;
            }

            // Check if this work item is already in the list
            const existingIndex = this.availableFiles.findIndex(file => file.id === node.id);
            if (existingIndex !== -1) {
                skippedCount++;
                continue;
            }

            try {
                if (this.availableFiles.length === 0 && firstItem) {
                    // First item - initialize the view
                    await this.loadWorkItemData(node);
                    firstItem = false;
                } else {
                    // Subsequent items - add to existing list
                    await this.addWorkItemToList(node);
                }
                addedCount++;
            } catch (error) {
                console.error(`Error adding work item ${node.id} to Wiki Maker:`, error);
            }
        }

        // Show summary notice
        let message = '';
        if (addedCount > 0) {
            message += `📝 Added ${addedCount} work item${addedCount !== 1 ? 's' : ''} to Wiki Maker`;
        }
        if (skippedCount > 0) {
            if (message) message += ', ';
            message += `${skippedCount} already in list`;
        }
        if (!message) {
            message = '❌ No new work items added';
        }

        new Notice(message);
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

                .wiki-maker-drop-zone {
                    border: 2px dashed var(--background-modifier-border);
                    border-radius: 12px;
                    transition: all 0.2s ease;
                    position: relative;
                }

                .wiki-maker-drop-zone--active {
                    border-color: var(--interactive-accent);
                    background: var(--interactive-accent-hover);
                    transform: scale(1.02);
                }

                .wiki-maker-drop-zone::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: transparent;
                    pointer-events: none;
                    border-radius: 10px;
                }

                .wiki-maker-drop-zone--active::before {
                    background: var(--interactive-accent);
                    opacity: 0.1;
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
        this.dropZoneInitialized = false;
    }
}