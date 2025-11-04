const mockTurndownService = {
    turndown: jest.fn().mockImplementation((html: string) => {
        // Simple HTML to markdown conversion for testing
        return html
            .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
            .replace(/<em>(.*?)<\/em>/g, '*$1*')
            .replace(/<code>(.*?)<\/code>/g, '`$1`')
            .replace(/<p>(.*?)<\/p>/g, '$1\n')
            .replace(/<table[^>]*>[\s\S]*?<\/table>/g, (table) => {
                // Extract table content for markdown conversion
                const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
                return rows.map(row => {
                    const cells = row.match(/<t[hd][^>]*>(.*?)<\/t[hd]>/g) || [];
                    return '| ' + cells.map(cell => cell.replace(/<[^>]*>/g, '')).join(' | ') + ' |';
                }).join('\n') + '\n';
            })
            .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
            .trim();
    }),
    addRule: jest.fn(),
    use: jest.fn()
};

const TurndownService = jest.fn().mockImplementation(() => mockTurndownService);

module.exports = TurndownService;
export default TurndownService;