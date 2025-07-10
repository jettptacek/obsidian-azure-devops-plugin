import { WorkspaceLeaf, ItemView, Menu, TFile, Notice } from 'obsidian';
import { WorkItemNode, WorkItemRelation } from './settings';

export const VIEW_TYPE_AZURE_DEVOPS_TREE = 'azure-devops-tree-view';

export class AzureDevOpsTreeView extends ItemView {
    plugin: any;
    workItemsTree: WorkItemNode[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: any) {
        super(leaf);
        this.plugin = plugin;
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
        
        // Simple header
        const header = this.containerEl.createDiv();
        header.style.padding = '10px';
        header.style.borderBottom = '1px solid var(--background-modifier-border)';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        
        const title = header.createEl('h3');
        title.textContent = 'Azure DevOps Work Items';
        title.style.margin = '0';
        
        const refreshBtn = header.createEl('button');
        refreshBtn.textContent = 'Refresh';
        refreshBtn.className = 'mod-cta';
        refreshBtn.addEventListener('click', () => this.refreshTreeView());

        // Simple tree container
        const treeContainer = this.containerEl.createDiv();
        treeContainer.style.padding = '10px';
        treeContainer.style.overflowY = 'auto';
        treeContainer.style.maxHeight = 'calc(100vh - 100px)';
        
        await this.buildTreeView(treeContainer);
    }

    async refreshTreeView() {
        const treeContainer = this.containerEl.children[1] as HTMLElement;
        if (treeContainer) {
            treeContainer.empty();
            await this.buildTreeView(treeContainer);
        }
    }

    async buildTreeView(container: HTMLElement) {
        try {
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
            row.style.minHeight = '28px';
            row.style.borderRadius = '4px';
            row.style.cursor = 'default';
            
            // Hover effect
            row.addEventListener('mouseenter', () => {
                row.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.backgroundColor = '';
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

            // Work item title - This is the main part that was getting cut off
            const titleSpan = row.createEl('span');
            titleSpan.textContent = `[${node.id}] ${node.title}`;
            titleSpan.style.flexGrow = '1';
            titleSpan.style.flexShrink = '1';
            titleSpan.style.minWidth = '200px'; // Ensure minimum width
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

    async onClose() {
        // Cleanup
    }
}