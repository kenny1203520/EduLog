/**
 * Converts a number to Roman numerals.
 */
export function toRoman(num: number): string {
    if (num <= 0 || num > 3999) return String(num);
    const lookup: [string, number][] = [
        ['M', 1000],
        ['CM', 900],
        ['D', 500],
        ['CD', 400],
        ['C', 100],
        ['XC', 90],
        ['L', 50],
        ['XL', 40],
        ['X', 10],
        ['IX', 9],
        ['V', 5],
        ['IV', 4],
        ['I', 1]
    ];
    let roman = '';
    for (const [letter, value] of lookup) {
        while (num >= value) {
            roman += letter;
            num -= value;
        }
    }
    return roman;
}

/**
 * Converts a number to Chinese numerals (一, 二, 三...).
 */
export function toChinese(num: number): string {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = ['', '十', '百', '千', '萬'];
    
    if (num === 0) return digits[0];
    if (num < 0) return '負' + toChinese(Math.abs(num));
    
    // Simple implementation for numbers < 100,000
    if (num >= 100000) return String(num);

    let res = '';
    const str = String(num);
    const len = str.length;
    
    for (let i = 0; i < len; i++) {
        const d = Number.parseInt(str[i], 10);
        const unitIdx = len - 1 - i;
        
        if (d !== 0) {
            // Special case for 10-19: "一十一" -> "十一"
            if (unitIdx === 1 && d === 1 && len === 2) {
                res += units[unitIdx];
            } else {
                res += digits[d] + units[unitIdx];
            }
        } else {
            // Avoid multiple zeros and zero at the end
            if (res !== '' && res[res.length - 1] !== digits[0] && unitIdx !== 0) {
                res += digits[0];
            }
        }
    }
    
    // Remove trailing zero if any
    if (res.length > 1 && res[res.length - 1] === digits[0]) {
        res = res.slice(0, -1);
    }
    
    return res;
}

/**
 * Converts a number to Formal Chinese numerals (壹, 貳, 參...).
 */
export function toFormalChinese(num: number): string {
    const digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
    const units = ['', '拾', '佰', '仟', '萬'];
    
    if (num === 0) return digits[0];
    if (num < 0) return '負' + toFormalChinese(Math.abs(num));
    
    if (num >= 100000) return String(num);

    let res = '';
    const str = String(num);
    const len = str.length;
    
    for (let i = 0; i < len; i++) {
        const d = Number.parseInt(str[i], 10);
        const unitIdx = len - 1 - i;
        
        if (d !== 0) {
            res += digits[d] + units[unitIdx];
        } else {
            if (res !== '' && res[res.length - 1] !== digits[0] && unitIdx !== 0) {
                res += digits[0];
            }
        }
    }
    
    if (res.length > 1 && res[res.length - 1] === digits[0]) {
        res = res.slice(0, -1);
    }
    
    return res;
}

/**
 * Formats a number based on a mode.
 */
export function formatNumber(num: number | string | undefined, mode: string): string {
    if (num === undefined || num === null || num === '') return '';
    const n = typeof num === 'string' ? Number.parseInt(num, 10) : num;
    if (Number.isNaN(n)) return String(num);

    switch (mode) {
        case 'roman':
            return toRoman(n);
        case 'chinese':
            return toChinese(n);
        case 'formal':
            return toFormalChinese(n);
        case 'arabic':
        default:
            return String(n);
    }
}
