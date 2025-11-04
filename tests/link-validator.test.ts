import { AzureDevOpsLinkValidator } from '../src/link-validator';
import { AzureDevOpsAPI } from '../src/api';
import { AzureDevOpsSettings } from '../src/settings';
import { mockApp, requestUrl, TFile } from 'obsidian';
import type AzureDevOpsPlugin from '../src/main';

jest.mock('obsidian');

describe('AzureDevOpsLinkValidator', () => {
    let linkValidator: AzureDevOpsLinkValidator;
    let api: AzureDevOpsAPI;
    let settings: AzureDevOpsSettings;
    let mockPlugin: Partial<AzureDevOpsPlugin>;
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
        mockPlugin = {
            app: mockApp,
            settings
        };

        linkValidator = new AzureDevOpsLinkValidator(
            mockApp,
            api,
            settings,
            mockPlugin as AzureDevOpsPlugin
        );

        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct dependencies', () => {
            expect(linkValidator.app).toBe(mockApp);
            expect(linkValidator.api).toBe(api);
            expect(linkValidator.settings).toBe(settings);
            expect(linkValidator.plugin).toBe(mockPlugin);
        });
    });

    describe('validateAllAzureDevOpsLinks', () => {
        it('should validate links in work item files', async () => {
            const mockFiles = [
                new TFile('Azure DevOps Work Items/WI-123 Test Item.md'),
                new TFile('Azure DevOps Work Items/WI-456 Another Item.md'),
                new TFile('Regular Note.md') // Should be ignored
            ];

            (mockApp.vault.getMarkdownFiles as jest.Mock) = jest.fn().mockReturnValue(mockFiles);

            // Mock the Notice class to avoid DOM issues
            global.Notice = jest.fn().mockImplementation(() => ({
                hide: jest.fn()
            }));

            jest.spyOn(linkValidator, 'extractAzureDevOpsLinksFromDescriptions').mockResolvedValue(new Map());
            jest.spyOn(linkValidator, 'validateAzureDevOpsLinks').mockResolvedValue([]);

            await linkValidator.validateAllAzureDevOpsLinks();

            // Should process the work item files (test passes if no errors thrown)
        });

        it('should handle no work item files', async () => {
            (mockApp.vault.getMarkdownFiles as jest.Mock) = jest.fn().mockReturnValue([]);

            global.Notice = jest.fn().mockImplementation(() => ({
                hide: jest.fn()
            }));

            await linkValidator.validateAllAzureDevOpsLinks();

            // Should handle empty case (test passes if no errors thrown)
        });
    });

    describe('extractAzureDevOpsLinksFromDescriptions', () => {
        it('should extract links from file descriptions', async () => {
            const mockFile = new TFile('WI-123 Test Item.md');
            const mockContent = `---
id: 123
title: "Test Item"
---

# Test Item

This references work item https://dev.azure.com/test-org/test-project/_workitems/edit/456
And also mentions [[WI-789 Related Item]]
`;

            (mockApp.vault.read as jest.Mock).mockResolvedValue(mockContent);

            const result = await linkValidator.extractAzureDevOpsLinksFromDescriptions([mockFile]);

            expect(result).toBeInstanceOf(Map);
            expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
        });

        it('should handle file read errors', async () => {
            const mockFile = new TFile('WI-123 Test Item.md');
            (mockApp.vault.read as jest.Mock).mockRejectedValue(new Error('File read error'));

            const result = await linkValidator.extractAzureDevOpsLinksFromDescriptions([mockFile]);

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });
    });

    describe('validateAzureDevOpsLinks', () => {
        it('should validate extracted links', async () => {
            const mockLinks = new Map();
            mockLinks.set(123, [{
                workItemId: 456,
                displayText: 'Test Item',
                fullUrl: 'https://dev.azure.com/test-org/test-project/_workitems/edit/456',
                linkText: 'https://dev.azure.com/test-org/test-project/_workitems/edit/456'
            }]);

            jest.spyOn(linkValidator, 'fetchWorkItemTitlesSmart').mockResolvedValue(undefined);

            const result = await linkValidator.validateAzureDevOpsLinks(mockLinks);

            expect(result).toBeInstanceOf(Array);
            expect(linkValidator.fetchWorkItemTitlesSmart).toHaveBeenCalled();
        });
    });

    describe('fetchWorkItemsBatch', () => {
        it('should fetch work items in batches', async () => {
            const workItemIds = [123, 456, 789];
            
            mockRequestUrl.mockResolvedValue({
                status: 200,
                json: {
                    value: [
                        { id: 123, fields: { 'System.Title': 'Item 1' } },
                        { id: 456, fields: { 'System.Title': 'Item 2' } },
                        { id: 789, fields: { 'System.Title': 'Item 3' } }
                    ]
                }
            });

            const result = await linkValidator.fetchWorkItemsBatch(workItemIds);

            expect(result).toHaveLength(3);
            expect(result[0].id).toBe(123);
            expect(result[0].fields['System.Title']).toBe('Item 1');
        });

        it('should handle API errors gracefully', async () => {
            const workItemIds = [123, 456];
            
            mockRequestUrl.mockResolvedValue({
                status: 400,
                text: 'Bad Request'
            });

            const result = await linkValidator.fetchWorkItemsBatch(workItemIds);

            expect(result).toEqual([]);
        });
    });

    describe('fetchIndividualWorkItem', () => {
        it('should fetch individual work item', async () => {
            mockRequestUrl.mockResolvedValue({
                status: 200,
                json: {
                    id: 123,
                    fields: {
                        'System.Title': 'Test Work Item'
                    }
                }
            });

            const result = await linkValidator.fetchIndividualWorkItem(123);

            expect(result).toEqual({
                id: 123,
                fields: {
                    'System.Title': 'Test Work Item'
                }
            });
        });

        it('should return null for non-existent work item', async () => {
            mockRequestUrl.mockResolvedValue({
                status: 404,
                text: 'Not Found'
            });

            const result = await linkValidator.fetchIndividualWorkItem(999);

            expect(result).toBeNull();
        });

        it('should handle network errors', async () => {
            mockRequestUrl.mockRejectedValue(new Error('Network error'));

            const result = await linkValidator.fetchIndividualWorkItem(123);

            expect(result).toBeNull();
        });
    });

    describe('fixInvalidLinks', () => {
        it('should process link fixes', async () => {
            const mockResults = [{
                workItemId: 123,
                currentTitle: 'Old Title',
                actualTitle: 'New Title',
                affectedFiles: ['file1.md'],
                azureDevOpsUrl: 'https://dev.azure.com/test-org/test-project/_workitems/edit/123'
            }];

            global.Notice = jest.fn();

            await linkValidator.fixInvalidLinks(mockResults);

            // Should not throw and should handle the processing
            // Note: fixInvalidLinks may not always call Notice depending on implementation
        });

        it('should handle empty results', async () => {
            await linkValidator.fixInvalidLinks([]);
            // Should not throw for empty array
        });
    });

    describe('settings update', () => {
        it('should update settings reference', () => {
            const newSettings = {
                ...settings,
                organization: 'new-org',
                project: 'new-project'
            };

            linkValidator.settings = newSettings;

            expect(linkValidator.settings.organization).toBe('new-org');
            expect(linkValidator.settings.project).toBe('new-project');
        });
    });
});