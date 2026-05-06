/**
 * parseMarkdownToText
 *
 * Strips and humanizes markdown for TTS playback. Ported verbatim from
 * matrx-frontend/utils/markdown-processors/parse-markdown-for-speech.ts.
 */

export function parseMarkdownToText(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return '';

  const numberToWords = (num: string): string => {
    const ones = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
      'sixteen',
      'seventeen',
      'eighteen',
      'nineteen',
    ];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const numInt = parseInt(num, 10);
    if (numInt < 20) return ones[numInt] ?? String(numInt);
    if (numInt < 100) {
      const t = Math.floor(numInt / 10);
      const o = numInt % 10;
      return o === 0 ? (tens[t] ?? '') : `${tens[t] ?? ''}-${ones[o] ?? ''}`;
    }
    if (numInt < 1000) {
      const h = Math.floor(numInt / 100);
      const remainder = numInt % 100;
      return remainder === 0
        ? `${ones[h] ?? ''} hundred`
        : `${ones[h] ?? ''} hundred ${numberToWords(String(remainder))}`;
    }
    return String(numInt);
  };

  const emojiMap: Record<string, string> = {
    '😊': 'smiling face',
    '😂': 'laughing face',
    '❤️': 'heart',
    '👍': 'thumbs up',
    '👎': 'thumbs down',
    '🔥': 'fire',
    '⭐': 'star',
    '✅': 'check mark',
    '❌': 'cross mark',
    '⚠️': 'warning',
    '🚀': 'rocket',
    '💡': 'light bulb',
    '🎯': 'target',
    '📱': 'mobile phone',
    '💻': 'laptop',
    '🌟': 'glowing star',
    '🔗': 'link',
    '📧': 'email',
    '📄': 'document',
    '📊': 'chart',
    '🛠️': 'tools',
    '⚙️': 'gear',
    '🔧': 'wrench',
    '📈': 'chart increasing',
    '📉': 'chart decreasing',
    '🎉': 'party popper',
    '💪': 'flexed biceps',
    '🤔': 'thinking face',
    '💭': 'thought bubble',
    '👀': 'eyes',
    '👋': 'waving hand',
    '✨': 'sparkles',
    '🔍': 'magnifying glass',
    '📝': 'memo',
    '📋': 'clipboard',
    '📅': 'calendar',
    '⏰': 'alarm clock',
    '🔒': 'locked',
    '🔓': 'unlocked',
    '🏆': 'trophy',
    '🎖️': 'military medal',
    '🎗️': 'reminder ribbon',
    '🏅': 'sports medal',
    '🥇': 'first place medal',
    '🥈': 'second place medal',
    '🥉': 'third place medal',
  };

  const commonAbbreviations: Record<string, string> = {
    AI: 'Artificial Intelligence',
    API: 'Application Programming Interface',
    HTTP: 'Hypertext Transfer Protocol',
    HTTPS: 'Hypertext Transfer Protocol Secure',
    URL: 'Uniform Resource Locator',
    URI: 'Uniform Resource Identifier',
    JSON: 'JavaScript Object Notation',
    XML: 'eXtensible Markup Language',
    CSS: 'Cascading Style Sheets',
    HTML: 'Hypertext Markup Language',
    JS: 'JavaScript',
    TS: 'TypeScript',
    SQL: 'Structured Query Language',
    DB: 'Database',
    UI: 'User Interface',
    UX: 'User Experience',
    SEO: 'Search Engine Optimization',
    SDK: 'Software Development Kit',
    CLI: 'Command Line Interface',
    IDE: 'Integrated Development Environment',
    JWT: 'JSON Web Token',
    OAuth: 'Open Authorization',
    REST: 'Representational State Transfer',
    CRUD: 'Create Read Update Delete',
    MVC: 'Model View Controller',
    SPA: 'Single Page Application',
    SSR: 'Server Side Rendering',
    CSR: 'Client Side Rendering',
    PWA: 'Progressive Web App',
    DOM: 'Document Object Model',
    BOM: 'Browser Object Model',
    CDN: 'Content Delivery Network',
    CMS: 'Content Management System',
    ERP: 'Enterprise Resource Planning',
    CRM: 'Customer Relationship Management',
    SaaS: 'Software as a Service',
    PaaS: 'Platform as a Service',
    IaaS: 'Infrastructure as a Service',
    VPN: 'Virtual Private Network',
    LAN: 'Local Area Network',
    WAN: 'Wide Area Network',
    TCP: 'Transmission Control Protocol',
    UDP: 'User Datagram Protocol',
    IP: 'Internet Protocol',
    DNS: 'Domain Name System',
    FTP: 'File Transfer Protocol',
    SMTP: 'Simple Mail Transfer Protocol',
    POP3: 'Post Office Protocol version 3',
    IMAP: 'Internet Message Access Protocol',
  };

  const measurementUnits: Record<string, string> = {
    lbs: 'pound',
    lb: 'pound',
    oz: 'ounce',
    kg: 'kilogram',
    gm: 'gram',
    mg: 'milligram',
    km: 'kilometer',
    cm: 'centimeter',
    mm: 'millimeter',
    ft: 'foot',
    mi: 'mile',
    mph: 'mile per hour',
    kph: 'kilometer per hour',
    kmh: 'kilometer per hour',
    ml: 'milliliter',
    mL: 'milliliter',
    gal: 'gallon',
    qt: 'quart',
    tbsp: 'tablespoon',
    tsp: 'teaspoon',
    sqft: 'square foot',
    sqm: 'square meter',
    sec: 'second',
    min: 'minute',
    hr: 'hour',
    hrs: 'hour',
    ms: 'millisecond',
    psi: 'pound per square inch',
    rpm: 'revolution per minute',
    bpm: 'beat per minute',
  };

  const stripReasoningTags = (input: string): string =>
    input
      .replace(/<(thinking|reasoning|think|reason)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/?(?:thinking|reasoning|think|reason)\b[^>]*>/gi, '');

  const stripLeadingMarkdown = (input: string): string => {
    let text = input.replace(/^﻿/, '').replace(/^[ \t]*\r?\n/, '');
    text = text.replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+|\d+\.[ \t]+|-[ \t]*\[[ xX]\][ \t]+)/, '');
    return text;
  };

  const result = stripLeadingMarkdown(stripReasoningTags(markdown))
    .replace(/```mermaid[\s\S]*?```/g, 'Please see the diagram provided.')
    .replace(
      /```(javascript|js|typescript|ts|python|py|java|csharp|cs|cpp|c\+\+|c|go|rust|php|ruby|swift|kotlin|scala|sql|bash|shell|powershell|yaml|yml|json|xml|html|css|markdown|md)[\s\S]*?```/g,
      'Please see the $1 code provided.',
    )
    .replace(/```[\s\S]*?```/g, 'Please see the code provided.')
    .replace(
      /(\|[^\n]+\|[ \t]*\n)([ \t]*\|[ \t]*[-:]+[ \t]*(?:\|[ \t]*[-:]+[ \t]*)*\|?[ \t]*\n)((?:[ \t]*\|[^\n]*\|[ \t]*\n?)*)/gm,
      (_fullMatch, headerRow, _separatorRow, dataRows) => {
        const headers = headerRow
          .split('|')
          .map((h: string) => h.trim())
          .filter((h: string) => h.length > 0);
        const rowCount = dataRows
          .split('\n')
          .filter((line: string) => line.trim().startsWith('|') && line.trim().length > 1).length;
        const headerText =
          headers.length > 1
            ? headers.slice(0, -1).join(', ') + ', and ' + headers[headers.length - 1]
            : headers.length === 1
              ? headers[0]
              : 'unlabeled columns';
        const rowText = rowCount === 1 ? 'one row' : rowCount > 0 ? `${rowCount} rows` : 'no rows';
        return `There is a table with ${rowText} of data provided for ${headerText}.\n`;
      },
    )
    .replace(/^\|.*\|[ \t]*$/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\b(\d+)\s*[-–—]\s*(\d+)\b/g, (_match, a, b) => `${numberToWords(a)} to ${numberToWords(b)}`)
    .replace(/^#{1,6}\s+(.+)$/gm, 'Section: $1')
    .replace(/\/\/\s*/g, '')
    .replace(/--\s*/g, '')
    .replace(/#\s+/g, '')
    .replace(/;\s*/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
      if (url.startsWith('mailto:')) return `${text}. Email address provided.`;
      const fileExtensions = [
        '.pdf',
        '.doc',
        '.docx',
        '.xls',
        '.xlsx',
        '.ppt',
        '.pptx',
        '.txt',
        '.md',
        '.json',
        '.xml',
        '.csv',
        '.zip',
      ];
      if (fileExtensions.some((ext) => url.toLowerCase().includes(ext))) return `${text}. Document link provided.`;
      return `${text}. Link provided.`;
    })
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_$0, alt) => (alt ? `${alt}. Image provided.` : 'Image provided.'))
    .replace(/^>\s*(.+)$/gm, 'Quote: $1')
    .replace(/^-\s*\[x\]\s+(.+)$/gm, 'Completed task: $1')
    .replace(/^-\s*\[\s*\]\s+(.+)$/gm, 'Pending task: $1')
    .replace(/^([-*+])\s+(.+)$/gm, '$2')
    .replace(/^(\d+)\.\s+(.+)$/gm, (_match, num, content) => `Number ${numberToWords(num)}: ${content}`)
    .replace(/\[\^(\d+)\]/g, 'Reference $1')
    .replace(/^\[\d+\]:\s*(.+)$/gm, 'Reference: $1')
    .replace(/^(\*{3,}|-{3,}|_{3,})$/gm, '')
    .replace(/\$([^$]+)\$/g, 'Mathematical expression: $1')
    .replace(/\$\$([^$]+)\$\$/g, 'Mathematical formula: $1')
    .replace(/(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, 'Phone number provided.')
    .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, 'Email address: $1')
    .replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, '$1 dollars')
    .replace(/€(\d+(?:[.,]\d{3})*(?:[.,]\d{2})?)/g, '$1 euros')
    .replace(/£(\d+(?:,\d{3})*(?:\.\d{2})?)/g, '$1 pounds')
    .replace(/¥(\d+(?:,\d{3})*(?:\.\d{2})?)/g, '$1 yen')
    .replace(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g, (_match, year, month, day) => {
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const monthName = monthNames[parseInt(month) - 1] || month;
      return `${monthName} ${day}, ${year}`;
    })
    .replace(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/g, (_match, hour, minute, period) => {
      const hourNum = parseInt(hour);
      const periodText = period ? (period.toUpperCase() === 'AM' ? 'A.M.' : 'P.M.') : '';
      return `${hourNum} ${minute} ${periodText}`.trim();
    })
    .replace(
      /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
      (emoji) => emojiMap[emoji] || 'emoji',
    )
    .replace(
      /\b(AI|API|HTTP|HTTPS|URL|URI|JSON|XML|CSS|HTML|JS|TS|SQL|DB|UI|UX|SEO|SDK|CLI|IDE|JWT|OAuth|REST|CRUD|MVC|SPA|SSR|CSR|PWA|DOM|BOM|CDN|CMS|ERP|CRM|SaaS|PaaS|IaaS|VPN|LAN|WAN|TCP|UDP|IP|DNS|FTP|SMTP|POP3|IMAP)\b/gi,
      (match) => commonAbbreviations[match.toUpperCase()] || match,
    )
    .replace(
      /(\d+(?:\.\d+)?)\s*(lbs|lb|oz|kg|gm|mg|km|cm|mm|ft|mi|mph|kph|kmh|ml|mL|gal|qt|tbsp|tsp|sqft|sqm|sec|min|hr|hrs|ms|psi|rpm|bpm)\b/gi,
      (_match, number, unit) => {
        const unitLower = unit.toLowerCase();
        const unitText = measurementUnits[unitLower] || measurementUnits[unit] || unit;
        return `${number} ${unitText}`;
      },
    )
    .replace(
      /\b(lbs|lb|oz|kg|gm|mg|km|cm|mm|mph|kph|kmh|ml|mL|gal|qt|tbsp|tsp|sqft|sqm|psi|rpm|bpm)(?=\s|$|[.,;!?])/gi,
      (match) => {
        const unitLower = match.toLowerCase();
        return measurementUnits[unitLower] || measurementUnits[match] || match;
      },
    )
    .replace(/©/g, 'copyright')
    .replace(/®/g, 'registered trademark')
    .replace(/™/g, 'trademark')
    .replace(/°/g, 'degrees')
    .replace(/±/g, 'plus or minus')
    .replace(/≈/g, 'approximately')
    .replace(/≠/g, 'not equal to')
    .replace(/≤/g, 'less than or equal to')
    .replace(/≥/g, 'greater than or equal to')
    .replace(/→/g, 'arrow')
    .replace(/←/g, 'left arrow')
    .replace(/↑/g, 'up arrow')
    .replace(/↓/g, 'down arrow')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/([^\s.!?,;:\-])(\n)/g, '$1.\n')
    .replace(/\s+/g, ' ')
    .trim();

  return result;
}
