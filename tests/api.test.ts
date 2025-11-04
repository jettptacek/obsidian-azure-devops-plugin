import { AzureDevOpsAPI, type WorkItemData } from '../src/api';
import { AzureDevOpsSettings } from '../src/settings';
import { requestUrl } from 'obsidian';

jest.mock('obsidian');

describe('AzureDevOpsAPI', () => {
    let api: AzureDevOpsAPI;
    let settings: AzureDevOpsSettings;
    const mockRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;

    beforeEach(() => {
        settings = {
            organization: 'test-org',
            project: 'test-project',
            personalAccessToken: 'test-token',
            useMarkdownInAzureDevOps: false,
            pendingChanges: {
                lastSaved: 0,
                changedNotes: [],
                changedRelationships: {}
            }
        };
        api = new AzureDevOpsAPI(settings);
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with settings', () => {
            expect(api.settings).toBe(settings);
        });
    });

    describe('updateSettings', () => {
        it('should update settings', () => {
            const newSettings = { ...settings, organization: 'new-org' };
            api.updateSettings(newSettings);
            expect(api.settings).toBe(newSettings);
        });
    });

    describe('validateWorkItemData', () => {
        it('should validate valid work item data', () => {
            const workItemData: WorkItemData = {
                title: 'Test Work Item',
                workItemType: 'Task',
                description: 'Test description'
            };

            const result = api.validateWorkItemData(workItemData);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should fail validation for missing title', () => {
            const workItemData: WorkItemData = {
                title: '',
                workItemType: 'Task'
            };

            const result = api.validateWorkItemData(workItemData);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Title is required');
        });

        it('should fail validation for missing work item type', () => {
            const workItemData: WorkItemData = {
                title: 'Test Title',
                workItemType: ''
            };

            const result = api.validateWorkItemData(workItemData);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Work item type is required');
        });

        it('should fail validation for title too long', () => {
            const workItemData: WorkItemData = {
                title: 'a'.repeat(256),
                workItemType: 'Task'
            };

            const result = api.validateWorkItemData(workItemData);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Title must be 255 characters or less');
        });

        it('should fail validation for description too long', () => {
            const workItemData: WorkItemData = {
                title: 'Test Title',
                workItemType: 'Task',
                description: 'a'.repeat(32001)
            };

            const result = api.validateWorkItemData(workItemData);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('Description must be 32,000 characters or less');
        });
    });

    describe('createWorkItem', () => {
        it('should create work item successfully', async () => {
            const workItemData: WorkItemData = {
                title: 'Test Work Item',
                workItemType: 'Task',
                description: 'Test description'
            };

            const mockResponse = {
                status: 201,
                json: {
                    id: 123,
                    fields: {
                        'System.Title': 'Test Work Item'
                    }
                }
            };

            mockRequestUrl.mockResolvedValue(mockResponse);

            const result = await api.createWorkItem(workItemData);

            expect(result).toEqual(mockResponse.json);
            expect(mockRequestUrl).toHaveBeenCalledWith({
                url: expect.stringContaining('test-org/test-project/_apis/wit/workitems'),
                method: 'POST',
                headers: {
                    'Authorization': expect.stringContaining('Basic'),
                    'Content-Type': 'application/json-patch+json'
                },
                body: expect.stringContaining('System.Title'),
                throw: false
            });
        });

        it('should return null for invalid settings', async () => {
            api.settings.organization = '';
            const workItemData: WorkItemData = {
                title: 'Test',
                workItemType: 'Task'
            };

            const result = await api.createWorkItem(workItemData);
            expect(result).toBeNull();
        });

        it('should handle API errors', async () => {
            const workItemData: WorkItemData = {
                title: 'Test Work Item',
                workItemType: 'Task'
            };

            mockRequestUrl.mockResolvedValue({
                status: 400,
                text: 'Bad Request'
            });

            const result = await api.createWorkItem(workItemData);
            expect(result).toBeNull();
        });
    });

    describe('getWorkItemTypes', () => {
        it('should fetch work item types successfully', async () => {
            const mockTypes = [
                { name: 'Task', isDisabled: false },
                { name: 'Bug', isDisabled: false },
                { name: 'Test Suite', isDisabled: false } // Should be filtered out
            ];

            mockRequestUrl.mockResolvedValue({
                status: 200,
                json: { value: mockTypes }
            });

            const result = await api.getWorkItemTypes();

            expect(result).toHaveLength(2);
            expect(result.find(t => t.name === 'Task')).toBeDefined();
            expect(result.find(t => t.name === 'Bug')).toBeDefined();
            expect(result.find(t => t.name === 'Test Suite')).toBeUndefined();
        });

        it('should return empty array for invalid settings', async () => {
            api.settings.project = '';
            const result = await api.getWorkItemTypes();
            expect(result).toEqual([]);
        });
    });

    describe('getSpecificWorkItem', () => {
        it('should fetch specific work item successfully', async () => {
            const mockWorkItem = {
                id: 123,
                fields: {
                    'System.Title': 'Test Work Item',
                    'System.Description': 'Test description'
                }
            };

            mockRequestUrl.mockResolvedValue({
                status: 200,
                json: mockWorkItem
            });

            const result = await api.getSpecificWorkItem(123);

            expect(result).toEqual(expect.objectContaining({
                id: 123,
                fields: expect.objectContaining({
                    'System.Title': 'Test Work Item'
                })
            }));
        });

        it('should return null for non-existent work item', async () => {
            mockRequestUrl.mockResolvedValue({
                status: 404,
                text: 'Not Found'
            });

            const result = await api.getSpecificWorkItem(999);
            expect(result).toBeNull();
        });
    });

    describe('updateWorkItem', () => {
        it('should update work item successfully', async () => {
            mockRequestUrl.mockResolvedValue({
                status: 200,
                json: {}
            });

            const updates = {
                title: 'Updated Title',
                description: 'Updated description',
                state: 'In Progress'
            };

            const result = await api.updateWorkItem(123, updates);

            expect(result).toBe(true);
            expect(mockRequestUrl).toHaveBeenCalledWith({
                url: expect.stringContaining('123'),
                method: 'PATCH',
                headers: {
                    'Authorization': expect.stringContaining('Basic'),
                    'Content-Type': 'application/json-patch+json'
                },
                body: expect.stringContaining('System.Title'),
                throw: false
            });
        });

        it('should handle update failures', async () => {
            mockRequestUrl.mockResolvedValue({
                status: 400,
                text: 'Bad Request'
            });

            const updates = { title: 'Updated Title' };
            const result = await api.updateWorkItem(123, updates);

            expect(result).toBe(false);
        });

        it('should return false for empty updates', async () => {
            const result = await api.updateWorkItem(123, {});
            expect(result).toBe(false);
            expect(mockRequestUrl).not.toHaveBeenCalled();
        });
    });

    describe('addParentChildRelationship', () => {
        it('should add parent-child relationship successfully', async () => {
            // Mock the getSpecificWorkItem call for removeAllParentRelationships
            mockRequestUrl
                .mockResolvedValueOnce({
                    status: 200,
                    json: { id: 123, relations: [] }
                })
                .mockResolvedValueOnce({
                    status: 200,
                    json: {}
                });

            const result = await api.addParentChildRelationship(123, 456);

            expect(result).toBe(true);
            expect(mockRequestUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'PATCH',
                    body: expect.stringContaining('System.LinkTypes.Hierarchy-Reverse')
                })
            );
        });

        it('should handle relationship addition failures', async () => {
            mockRequestUrl
                .mockResolvedValueOnce({
                    status: 200,
                    json: { id: 123, relations: [] }
                })
                .mockResolvedValueOnce({
                    status: 400,
                    text: 'Bad Request'
                });

            const result = await api.addParentChildRelationship(123, 456);
            expect(result).toBe(false);
        });
    });

    describe('downloadWorkItemIcon', () => {
        it('should download SVG icon successfully', async () => {
            const mockSvgContent = '<svg><circle r="10"/></svg>';
            mockRequestUrl.mockResolvedValue({
                status: 200,
                text: mockSvgContent
            });

            const result = await api.downloadWorkItemIcon('https://example.com/icon.svg');

            expect(result).toContain('data:image/svg+xml');
            expect(result).toContain(encodeURIComponent('<svg><circle r="10"/></svg>'));
        });

        it('should return null for failed download', async () => {
            mockRequestUrl.mockResolvedValue({
                status: 404,
                text: 'Not Found'
            });

            const result = await api.downloadWorkItemIcon('https://example.com/icon.svg');
            expect(result).toBeNull();
        });

        it('should return null for empty icon URL', async () => {
            const result = await api.downloadWorkItemIcon('');
            expect(result).toBeNull();
        });
    });
});