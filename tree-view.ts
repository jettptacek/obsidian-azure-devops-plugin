import { WorkspaceLeaf, ItemView, Menu, TFile, Notice } from 'obsidian';
import { WorkItemNode, WorkItemRelation } from './settings';

export const VIEW_TYPE_AZURE_DEVOPS_TREE = 'azure-devops-tree-view';

export class AzureDevOpsTreeView extends ItemView {
    plugin: any;
    workItemsTree: WorkItemNode[] = [];
    draggedNode: WorkItemNode | null = null;
    allNodes: Map<number, WorkItemNode> = new Map();
    workItemTypeIcons: Map<string, string> = new Map(); // Cache for work item type icons
    iconLoadPromises: Map<string, Promise<string | null>> = new Map(); // Prevent duplicate downloads

    constructor(leaf: WorkspaceLeaf, plugin: any) {
        super(leaf);
        this.plugin = plugin;
    }

    // Helper method for image error handling
    addImageErrorHandling(iconImg: HTMLImageElement, iconContainer: HTMLElement, workItemType: string) {
        iconImg.addEventListener('error', () => {
            console.log(`Failed to display icon for ${workItemType}, falling back to emoji`);
            // Replace with emoji fallback
            iconContainer.empty();
            const emojiIcons: { [key: string]: string } = {
                'Epic': '🎯', 'Feature': '🚀', 'User Story': '📝', 'Task': '✅', 
                'Bug': '🐛', 'Issue': '⚠️', 'Test Case': '🧪', 'Requirement': '📋'
            };
            iconContainer.textContent = emojiIcons[workItemType] || '📋';
            iconContainer.style.fontSize = '14px';
            iconContainer.title = workItemType;
        });
        
        iconImg.addEventListener('load', () => {
            console.log(`Successfully displayed icon for ${workItemType}`);
        });
    }

    getViewType(): string {
        return VIEW_TYPE_AZURE_DEVOPS_TREE;
    }

    getDisplayText(): string {
        return 'Azure DevOps Tree';
    }

    getIcon(): string {
        return 'git-branch';
    }

    async onOpen() {
        this.containerEl.empty();
        
        // Header
        const header = this.containerEl.createDiv();
        header.style.padding = '10px';
        header.style.borderBottom = '1px solid var(--background-modifier-border)';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        
        const title = header.createEl('h3');
        title.textContent = 'Azure DevOps Work Items';
        title.style.margin = '0';
        
        const buttonContainer = header.createDiv();
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '8px';
        
        const refreshBtn = buttonContainer.createEl('button');
        refreshBtn.textContent = 'Refresh';
        refreshBtn.className = 'mod-cta';
        refreshBtn.addEventListener('click', () => this.refreshTreeView());

        const pushRelationsBtn = buttonContainer.createEl('button');
        pushRelationsBtn.textContent = 'Push Relations';
        pushRelationsBtn.className = 'mod-warning';
        pushRelationsBtn.addEventListener('click', () => this.pushAllRelationshipChanges());

        // Instructions
        const instructions = this.containerEl.createDiv();
        instructions.style.padding = '8px 10px';
        instructions.style.backgroundColor = 'var(--background-secondary)';
        instructions.style.fontSize = '12px';
        instructions.style.color = 'var(--text-muted)';
        instructions.innerHTML = '💡 <strong>Drag & Drop:</strong> Drag work items to change parent-child relationships. Click "Push Relations" to sync changes to Azure DevOps.';

        // Tree container
        const treeContainer = this.containerEl.createDiv();
        treeContainer.style.padding = '10px';
        treeContainer.style.overflowY = 'auto';
        treeContainer.style.maxHeight = 'calc(100vh - 140px)';
        
        await this.buildTreeView(treeContainer);
    }

    async refreshTreeView() {
        // Clear icon cache to force reload
        this.workItemTypeIcons.clear();
        this.iconLoadPromises.clear();
        
        const treeContainer = this.containerEl.children[2] as HTMLElement;
        if (treeContainer) {
            treeContainer.empty();
            await this.buildTreeView(treeContainer);
        }
    }

    async buildTreeView(container: HTMLElement) {
        try {
            // Load work item type icons first
            await this.loadWorkItemTypeIcons();
            
            const workItems = await this.plugin.getWorkItemsWithRelations();
            
            if (workItems.length === 0) {
                const message = container.createEl('p');
                message.textContent = 'No work items found. Pull work items first.';
                message.style.textAlign = 'center';
                message.style.color = 'var(--text-muted)';
                return;
            }

            this.workItemsTree = this.buildWorkItemTree(workItems);
            this.renderTree(container, this.workItemsTree);
            
        } catch (error) {
            const errorMsg = container.createEl('p');
            errorMsg.textContent = `Error loading work items: ${error.message}`;
            errorMsg.style.color = 'var(--text-error)';
            errorMsg.style.textAlign = 'center';
        }
    }

    buildWorkItemTree(workItems: any[]): WorkItemNode[] {
        const nodeMap = new Map<number, WorkItemNode>();
        const rootNodes: WorkItemNode[] = [];

        // Create all nodes
        for (const workItem of workItems) {
            const fields = workItem.fields;
            const node: WorkItemNode = {
                id: workItem.id,
                title: fields['System.Title'] || 'Untitled',
                type: fields['System.WorkItemType'] || 'Unknown',
                state: fields['System.State'] || 'Unknown',
                assignedTo: fields['System.AssignedTo']?.displayName || 'Unassigned',
                priority: fields['Microsoft.VSTS.Common.Priority']?.toString() || '',
                children: [],
                filePath: this.getWorkItemFilePath(workItem.id, fields['System.Title'])
            };
            nodeMap.set(workItem.id, node);
        }

        // Store all nodes for relationship management
        this.allNodes = nodeMap;

        // Build relationships
        for (const workItem of workItems) {
            const node = nodeMap.get(workItem.id);
            if (!node) continue;

            const relations = workItem.relations || [];
            const parentRelation = relations.find((rel: WorkItemRelation) => 
                rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
            );

            if (parentRelation) {
                const parentIdMatch = parentRelation.url.match(/\/(\d+)$/);
                if (parentIdMatch) {
                    const parentId = parseInt(parentIdMatch[1]);
                    const parentNode = nodeMap.get(parentId);
                    if (parentNode) {
                        parentNode.children.push(node);
                        node.parent = parentNode;
                    }
                }
            }
        }

        // Get root nodes
        for (const node of nodeMap.values()) {
            if (!node.parent) {
                rootNodes.push(node);
            }
        }

        this.sortNodes(rootNodes);
        return rootNodes;
    }

    sortNodes(nodes: WorkItemNode[]) {
        const typePriority: { [key: string]: number } = {
            'Epic': 1, 'Feature': 2, 'User Story': 3, 'Task': 4, 'Bug': 5, 'Issue': 6
        };
        
        nodes.sort((a, b) => {
            const aPriority = typePriority[a.type] || 7;
            const bPriority = typePriority[b.type] || 7;
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.title.localeCompare(b.title);
        });
        
        nodes.forEach(node => {
            if (node.children.length > 0) {
                this.sortNodes(node.children);
            }
        });
    }

    renderTree(container: HTMLElement, nodes: WorkItemNode[], level: number = 0) {
        for (const node of nodes) {
            // Create the main row
            const row = container.createDiv();
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.padding = '4px 0';
            row.style.marginLeft = `${level * 20}px`;
            row.style.minHeight = '32px';
            row.style.borderRadius = '4px';
            row.style.cursor = 'grab';
            row.style.position = 'relative';
            row.draggable = true;
            
            // Store node reference on element
            (row as any).workItemNode = node;

            // Drag and drop handlers
            row.addEventListener('dragstart', (e) => {
                this.draggedNode = node;
                row.style.opacity = '0.5';
                e.dataTransfer!.effectAllowed = 'move';
                e.dataTransfer!.setData('text/plain', node.id.toString());
            });

            row.addEventListener('dragend', () => {
                row.style.opacity = '1';
                this.draggedNode = null;
                this.removeAllDropIndicators();
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer!.dropEffect = 'move';
                
                if (this.draggedNode && this.draggedNode.id !== node.id && !this.isDescendant(this.draggedNode, node)) {
                    this.showDropIndicator(row, true);
                }
            });

            row.addEventListener('dragleave', () => {
                this.showDropIndicator(row, false);
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                this.showDropIndicator(row, false);
                
                if (this.draggedNode && this.draggedNode.id !== node.id && !this.isDescendant(this.draggedNode, node)) {
                    this.changeParentChild(this.draggedNode, node);
                }
            });

            // Hover effect
            row.addEventListener('mouseenter', () => {
                if (!this.draggedNode) {
                    row.style.backgroundColor = 'var(--background-modifier-hover)';
                }
            });
            row.addEventListener('mouseleave', () => {
                if (!this.draggedNode) {
                    row.style.backgroundColor = '';
                }
            });

            // Expand/collapse button
            const expandBtn = row.createEl('span');
            expandBtn.style.width = '20px';
            expandBtn.style.height = '20px';
            expandBtn.style.display = 'flex';
            expandBtn.style.alignItems = 'center';
            expandBtn.style.justifyContent = 'center';
            expandBtn.style.cursor = 'pointer';
            expandBtn.style.fontSize = '12px';
            expandBtn.style.color = 'var(--text-muted)';
            expandBtn.style.marginRight = '8px';
            expandBtn.style.flexShrink = '0';

            if (node.children.length > 0) {
                expandBtn.textContent = '▼';
            } else {
                expandBtn.textContent = '•';
                expandBtn.style.cursor = 'default';
                expandBtn.style.opacity = '0.5';
            }

            // Drag handle
            const dragHandle = row.createEl('span');
            dragHandle.textContent = '⋮⋮';
            dragHandle.style.fontSize = '14px';
            dragHandle.style.color = 'var(--text-muted)';
            dragHandle.style.marginRight = '8px';
            dragHandle.style.cursor = 'grab';
            dragHandle.style.flexShrink = '0';

            // Work item type icon (real Azure DevOps icon or emoji fallback)
            const iconContainer = row.createEl('span');
            iconContainer.style.width = '20px';
            iconContainer.style.height = '20px';
            iconContainer.style.display = 'flex';
            iconContainer.style.alignItems = 'center';
            iconContainer.style.justifyContent = 'center';
            iconContainer.style.marginRight = '8px';
            iconContainer.style.flexShrink = '0';

            const iconInfo = this.getWorkItemTypeIcon(node.type);
            if (iconInfo.type === 'image') {
                // Use real Azure DevOps icon
                if (iconInfo.value.startsWith('data:image/svg+xml')) {
                    // Handle SVG icons differently
                    iconContainer.innerHTML = '';
                    const svgData = iconInfo.value.split(',')[1];
                    const svgContent = decodeURIComponent(svgData);
                    
                    try {
                        // Create SVG element directly
                        const parser = new DOMParser();
                        const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
                        const svgElement = svgDoc.documentElement;
                        
                        if (svgElement && svgElement.tagName === 'svg') {
                            // Set SVG attributes for proper display
                            svgElement.setAttribute('width', '16');
                            svgElement.setAttribute('height', '16');
                            svgElement.style.width = '16px';
                            svgElement.style.height = '16px';
                            
                            iconContainer.appendChild(svgElement);
                        } else {
                            throw new Error('Invalid SVG content');
                        }
                    } catch (error) {
                        // Fallback to img element
                        const iconImg = iconContainer.createEl('img');
                        iconImg.src = iconInfo.value;
                        iconImg.style.width = '16px';
                        iconImg.style.height = '16px';
                        iconImg.style.objectFit = 'contain';
                        iconImg.alt = node.type;
                        iconImg.title = node.type;
                        this.addImageErrorHandling(iconImg, iconContainer, node.type);
                    }
                } else {
                    // Regular image (PNG, JPEG, etc.)
                    const iconImg = iconContainer.createEl('img');
                    iconImg.src = iconInfo.value;
                    iconImg.style.width = '16px';
                    iconImg.style.height = '16px';
                    iconImg.style.objectFit = 'contain';
                    iconImg.alt = node.type;
                    iconImg.title = node.type;
                    this.addImageErrorHandling(iconImg, iconContainer, node.type);
                }
            } else {
                // Use emoji fallback
                iconContainer.textContent = iconInfo.value;
                iconContainer.style.fontSize = '14px';
                iconContainer.title = node.type;
            }

            // Work item title
            const titleSpan = row.createEl('span');
            titleSpan.textContent = `[${node.id}] ${node.title}`;
            titleSpan.style.flexGrow = '1';
            titleSpan.style.flexShrink = '1';
            titleSpan.style.minWidth = '200px';
            titleSpan.style.marginRight = '12px';
            titleSpan.style.cursor = 'pointer';
            titleSpan.style.fontWeight = '500';
            titleSpan.style.color = 'var(--text-normal)';
            titleSpan.style.padding = '4px 8px';
            titleSpan.style.borderRadius = '4px';
            titleSpan.style.whiteSpace = 'nowrap';
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';

            // Title hover and click
            titleSpan.addEventListener('mouseenter', () => {
                titleSpan.style.backgroundColor = 'var(--interactive-hover)';
                titleSpan.style.color = 'var(--interactive-accent)';
            });
            titleSpan.addEventListener('mouseleave', () => {
                titleSpan.style.backgroundColor = '';
                titleSpan.style.color = 'var(--text-normal)';
            });
            titleSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openWorkItemNote(node);
            });

            // State badge
            const stateBadge = row.createEl('span');
            stateBadge.textContent = node.state;
            stateBadge.style.fontSize = '10px';
            stateBadge.style.padding = '2px 6px';
            stateBadge.style.borderRadius = '10px';
            stateBadge.style.fontWeight = '600';
            stateBadge.style.textTransform = 'uppercase';
            stateBadge.style.marginRight = '6px';
            stateBadge.style.flexShrink = '0';
            stateBadge.style.whiteSpace = 'nowrap';
            
            // State colors
            const stateKey = node.state.toLowerCase().replace(/\s+/g, '-');
            if (['new', 'active', 'to-do'].includes(stateKey)) {
                stateBadge.style.backgroundColor = '#e3f2fd';
                stateBadge.style.color = '#1976d2';
            } else if (['resolved', 'closed', 'done'].includes(stateKey)) {
                stateBadge.style.backgroundColor = '#e8f5e8';
                stateBadge.style.color = '#2e7d32';
            } else if (stateKey === 'removed') {
                stateBadge.style.backgroundColor = '#ffebee';
                stateBadge.style.color = '#c62828';
            } else {
                stateBadge.style.backgroundColor = 'var(--background-modifier-border)';
                stateBadge.style.color = 'var(--text-muted)';
            }

            // Priority badge
            if (node.priority) {
                const priorityBadge = row.createEl('span');
                priorityBadge.textContent = `P${node.priority}`;
                priorityBadge.style.fontSize = '10px';
                priorityBadge.style.padding = '2px 6px';
                priorityBadge.style.borderRadius = '6px';
                priorityBadge.style.backgroundColor = 'var(--background-modifier-border)';
                priorityBadge.style.color = 'var(--text-muted)';
                priorityBadge.style.fontWeight = '600';
                priorityBadge.style.marginRight = '6px';
                priorityBadge.style.flexShrink = '0';
                priorityBadge.style.whiteSpace = 'nowrap';
            }

            // Assignee badge
            if (node.assignedTo && node.assignedTo !== 'Unassigned') {
                const assigneeBadge = row.createEl('span');
                assigneeBadge.textContent = node.assignedTo.split(' ')[0];
                assigneeBadge.style.fontSize = '10px';
                assigneeBadge.style.padding = '2px 8px';
                assigneeBadge.style.borderRadius = '10px';
                assigneeBadge.style.backgroundColor = 'var(--interactive-accent)';
                assigneeBadge.style.color = 'var(--text-on-accent)';
                assigneeBadge.style.fontWeight = '500';
                assigneeBadge.style.flexShrink = '0';
                assigneeBadge.style.whiteSpace = 'nowrap';
            }

            // Children container
            const childrenContainer = container.createDiv();
            childrenContainer.style.display = 'block';

            // Event handlers
            if (node.children.length > 0) {
                expandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleNode(childrenContainer, expandBtn);
                });

                // Render children
                this.renderTree(childrenContainer, node.children, level + 1);
            }

            // Context menu
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, node);
            });
        }
    }

    // Relationship management methods
    changeParentChild(childNode: WorkItemNode, newParentNode: WorkItemNode) {
        // Remove from old parent
        if (childNode.parent) {
            const oldParent = childNode.parent;
            oldParent.children = oldParent.children.filter(child => child.id !== childNode.id);
        } else {
            // Remove from root nodes
            this.workItemsTree = this.workItemsTree.filter(node => node.id !== childNode.id);
        }

        // Add to new parent
        newParentNode.children.push(childNode);
        childNode.parent = newParentNode;

        // Sort children
        this.sortNodes(newParentNode.children);

        // Refresh the tree display
        this.refreshTreeDisplay();

        new Notice(`Moved [${childNode.id}] ${childNode.title} under [${newParentNode.id}] ${newParentNode.title}. Click "Push Relations" to sync to Azure DevOps.`);
    }

    isDescendant(ancestor: WorkItemNode, potential: WorkItemNode): boolean {
        let current = potential.parent;
        while (current) {
            if (current.id === ancestor.id) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    showDropIndicator(element: HTMLElement, show: boolean) {
        if (show) {
            element.style.borderTop = '2px solid var(--interactive-accent)';
            element.style.backgroundColor = 'var(--background-modifier-hover)';
        } else {
            element.style.borderTop = '';
            element.style.backgroundColor = '';
        }
    }

    removeAllDropIndicators() {
        const rows = this.containerEl.querySelectorAll('[draggable="true"]');
        rows.forEach(row => {
            (row as HTMLElement).style.borderTop = '';
            (row as HTMLElement).style.backgroundColor = '';
        });
    }

    async refreshTreeDisplay() {
        const treeContainer = this.containerEl.children[2] as HTMLElement;
        if (treeContainer) {
            treeContainer.empty();
            this.renderTree(treeContainer, this.workItemsTree);
        }
    }

    async pushAllRelationshipChanges() {
        try {
            const relationshipUpdates: Array<{childId: number, parentId: number | null}> = [];
            
            // Collect all current relationships from the tree
            const collectRelationships = (node: WorkItemNode, parentId: number | null = null) => {
                relationshipUpdates.push({
                    childId: node.id,
                    parentId: parentId
                });
                
                node.children.forEach(child => {
                    collectRelationships(child, node.id);
                });
            };

            this.workItemsTree.forEach(node => collectRelationships(node));

            new Notice(`Updating relationships for ${relationshipUpdates.length} work items...`);

            let successCount = 0;
            let errorCount = 0;

            for (const update of relationshipUpdates) {
                try {
                    if (update.parentId) {
                        // Add parent relationship
                        const success = await this.plugin.api.addParentChildRelationship(update.childId, update.parentId);
                        if (success) {
                            successCount++;
                        } else {
                            errorCount++;
                        }
                    } else {
                        // This is a root item - we might need to remove existing parent relationships
                        await this.plugin.api.removeAllParentRelationships(update.childId);
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Error updating relationship for work item ${update.childId}:`, error);
                    errorCount++;
                }
            }

            if (errorCount === 0) {
                new Notice(`Successfully updated all ${successCount} relationships!`);
            } else {
                new Notice(`Updated ${successCount} relationships, ${errorCount} failed. Check console for details.`);
            }
            
            // Refresh to get latest data from Azure DevOps
            setTimeout(() => {
                this.refreshTreeView();
            }, 2000);

        } catch (error) {
            new Notice(`Error pushing relationships: ${error.message}`);
        }
    }

    toggleNode(childrenContainer: HTMLElement, expandBtn: HTMLElement) {
        if (childrenContainer.style.display === 'none') {
            childrenContainer.style.display = 'block';
            expandBtn.textContent = '▼';
        } else {
            childrenContainer.style.display = 'none';
            expandBtn.textContent = '▶';
        }
    }

    getWorkItemFilePath(id: number, title: string): string {
        const safeTitle = this.plugin.sanitizeFileName(title);
        return `Azure DevOps Work Items/WI-${id} ${safeTitle}.md`;
    }

    async openWorkItemNote(node: WorkItemNode) {
        if (!node.filePath) return;
        
        const file = this.app.vault.getAbstractFileByPath(node.filePath);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        } else {
            new Notice(`Work item note not found. Pull work items to create it.`);
        }
    }

    showContextMenu(event: MouseEvent, node: WorkItemNode) {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Open Work Item')
                .setIcon('external-link')
                .onClick(() => this.openWorkItemNote(node));
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Make Root Item')
                .setIcon('arrow-up')
                .onClick(() => this.makeRootItem(node));
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Pull from Azure DevOps')
                .setIcon('download')
                .onClick(async () => {
                    const file = this.app.vault.getAbstractFileByPath(node.filePath || '');
                    if (file instanceof TFile) {
                        await this.plugin.pullSpecificWorkItem(file);
                    } else {
                        new Notice('Work item note not found. Pull all work items first.');
                    }
                });
        });

        menu.addItem((item) => {
            item.setTitle('Push to Azure DevOps')
                .setIcon('upload')
                .onClick(async () => {
                    const file = this.app.vault.getAbstractFileByPath(node.filePath || '');
                    if (file instanceof TFile) {
                        await this.plugin.pushSpecificWorkItem(file);
                    } else {
                        new Notice('Work item note not found.');
                    }
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('View in Azure DevOps')
                .setIcon('external-link')
                .onClick(() => {
                    const url = `https://dev.azure.com/${this.plugin.settings.organization}/${encodeURIComponent(this.plugin.settings.project)}/_workitems/edit/${node.id}`;
                    window.open(url, '_blank');
                });
        });

        menu.showAtMouseEvent(event);
    }

    makeRootItem(node: WorkItemNode) {
        // Remove from current parent
        if (node.parent) {
            const oldParent = node.parent;
            oldParent.children = oldParent.children.filter(child => child.id !== node.id);
            node.parent = undefined;
        }

        // Add to root if not already there
        if (!this.workItemsTree.find(n => n.id === node.id)) {
            this.workItemsTree.push(node);
            this.sortNodes(this.workItemsTree);
        }

        this.refreshTreeDisplay();
        new Notice(`Made [${node.id}] ${node.title} a root item. Click "Push Relations" to sync to Azure DevOps.`);
    }

    async onClose() {
        // Cleanup
    }

    // Load work item type icons from Azure DevOps
    async loadWorkItemTypeIcons() {
        try {
            const workItemTypes = await this.plugin.api.getWorkItemTypes();
            const iconPromises = [];
            
            for (const workItemType of workItemTypes) {
                const typeName = workItemType.name;
                const iconUrl = workItemType.icon?.url;
                
                if (iconUrl && !this.workItemTypeIcons.has(typeName)) {
                    if (!this.iconLoadPromises.has(typeName)) {
                        const iconPromise = this.plugin.api.downloadWorkItemIcon(iconUrl, typeName)
                            .then((iconDataUrl: string | null) => {
                                if (iconDataUrl) {
                                    this.workItemTypeIcons.set(typeName, iconDataUrl);
                                }
                                return iconDataUrl;
                            })
                            .catch((error: any) => {
                                console.error(`Error loading icon for ${typeName}:`, error);
                                return null;
                            });
                        
                        this.iconLoadPromises.set(typeName, iconPromise);
                        iconPromises.push(iconPromise);
                    }
                }
            }
            
            // Wait for all icon downloads to complete
            if (iconPromises.length > 0) {
                await Promise.allSettled(iconPromises);
            }
            
            // Clean up promises
            this.iconLoadPromises.clear();
            
        } catch (error) {
            console.error('Error loading work item type icons:', error);
        }
    }

    // Get work item type icon (real icon from Azure DevOps or fallback)
    getWorkItemTypeIcon(workItemType: string): { type: 'image' | 'text', value: string } {
        // Check if we have a real icon from Azure DevOps
        const realIcon = this.workItemTypeIcons.get(workItemType);
        if (realIcon) {
            return { type: 'image', value: realIcon };
        }
        
        // Fallback to emoji icons
        const emojiIcons: { [key: string]: string } = {
            'Epic': '🎯',
            'Feature': '🚀',
            'User Story': '📝',
            'Task': '✅',
            'Bug': '🐛',
            'Issue': '⚠️',
            'Test Case': '🧪',
            'Requirement': '📋',
            'Risk': '⚠️',
            'Impediment': '🚧'
        };
        
        return { type: 'text', value: emojiIcons[workItemType] || '📋' };
    }

    // Debug method to check icon loading status
    debugIconStatus() {
        console.log('=== ICON DEBUG STATUS ===');
        console.log('Cached icons:', Array.from(this.workItemTypeIcons.entries()));
        console.log('Pending icon downloads:', Array.from(this.iconLoadPromises.keys()));
        
        // Test if we can access Azure DevOps API
        this.plugin.api.getWorkItemTypes().then((types: any[]) => {
            console.log('Available work item types from API:');
            types.forEach((type: any) => {
                console.log(`- ${type.name}: icon URL = ${type.icon?.url || 'NO ICON URL'}`);
            });
            
            if (types.length === 0) {
                console.error('❌ No work item types returned from API - check your connection and permissions');
            } else if (types.every((type: any) => !type.icon?.url)) {
                console.warn('⚠️ No work item types have icon URLs - your Azure DevOps project may not have icons configured');
            } else {
                console.log('✅ Found work item types with icon URLs');
            }
        }).catch((error: any) => {
            console.error('❌ Failed to fetch work item types:', error);
        });
    }
}