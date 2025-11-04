const markedFunction = jest.fn().mockImplementation((markdown: string) => {
    // Simple markdown to HTML conversion for testing
    const html = markdown
        .replace(/^\# (.*$)/gm, '<h1>$1</h1>')
        .replace(/^\## (.*$)/gm, '<h2>$1</h2>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/^\| (.+) \|$/gm, (match) => {
            // Convert markdown table rows to HTML
            const cells = match.slice(2, -2).split(' | ');
            return '<tr>' + cells.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
        });
    
    // Wrap in table tags if contains table rows
    if (html.includes('<tr>')) {
        return '<table>' + html + '</table>';
    }
    
    // Wrap in paragraph if no other tags
    if (!html.includes('<h') && !html.includes('<table')) {
        return `<p>${html}</p>`;
    }
    
    return Promise.resolve(html);
});

markedFunction.setOptions = jest.fn();

export const marked = markedFunction;

export default markedFunction;