/**
 * WhatsApp Chat Importer
 * Parses _chat.txt exports and converts them to Cove message format
 */

/**
 * Parse a WhatsApp _chat.txt file content
 * @param {string} fileContent - Raw text content of the WhatsApp export
 * @returns {Array<{timestamp: Date, sender: string, text: string}>} - Parsed messages
 */
export function parseWhatsAppChat(fileContent) {
    const lines = fileContent.split('\n');
    const messages = [];
    let currentMsg = null;

    // Common WhatsApp export formats:
    // [DD/MM/YYYY, HH:mm:ss] Sender: Message
    // DD/MM/YYYY, HH:mm - Sender: Message
    const datePatterns = [
        /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]\s+(.+?):\s*(.*)/i,
        /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s+[-–]\s+(.+?):\s*(.*)/i,
        /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?):\s*(.*)/i,
    ];

    for (const line of lines) {
        if (!line.trim()) continue;

        let matched = false;
        for (const pattern of datePatterns) {
            const match = line.match(pattern);
            if (match) {
                // Save previous message if any
                if (currentMsg) messages.push(currentMsg);

                const [, date, time, sender, text] = match;
                const dateStr = `${date} ${time}`;
                let parsedDate;

                // Try DD/MM/YYYY
                const parts = date.split('/');
                if (parts.length === 3) {
                    const [d, m, y] = parts;
                    const year = y.length === 2 ? `20${y}` : y;
                    parsedDate = new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${time.replace(/\s*[AP]M/i, '').trim()}`);
                } else {
                    parsedDate = new Date(dateStr);
                }

                // Skip system messages
                const systemSenders = ['Messages and calls are end-to-end encrypted', 'You created', 'added', 'removed', 'left', 'changed'];
                const isSystem = systemSenders.some(s => text.toLowerCase().includes(s.toLowerCase()) || sender.toLowerCase().includes(s.toLowerCase()));

                currentMsg = {
                    timestamp: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
                    sender: sender.trim(),
                    text: text.trim(),
                    isSystem,
                };

                matched = true;
                break;
            }
        }

        // Multi-line message continuation
        if (!matched && currentMsg) {
            currentMsg.text += '\n' + line;
        }
    }

    // Push last message
    if (currentMsg) messages.push(currentMsg);

    return messages.filter(m => !m.isSystem && m.text && m.text !== '<Media omitted>');
}

/**
 * Convert parsed WhatsApp messages to Cove format for batch upload
 * @param {Array} parsed - Output from parseWhatsAppChat
 * @param {string} contactId - PocketBase contact/chat ID to associate messages with
 * @param {string} userEmail - Current user's email (to map sender)
 * @param {Object} senderEmailMap - Map of WhatsApp display names to email addresses
 * @returns {Array} - Array of PocketBase-ready message objects
 */
export function convertToCoveMessages(parsed, contactId, userEmail, senderEmailMap = {}) {
    return parsed.map(msg => ({
        contact: contactId,
        text: msg.text,
        senderEmail: senderEmailMap[msg.sender] || userEmail,
        fileUrl: null,
        fileType: null,
        imported: true,
        importedFrom: 'whatsapp',
        created: msg.timestamp.toISOString(),
    }));
}
