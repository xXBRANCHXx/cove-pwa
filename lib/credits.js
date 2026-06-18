/**
 * Cove Credit System — Token-based AI usage tracking
 * Free users: 10 Credits/week (1 Credit = 1,000 Tokens)
 * Pro users: Unlimited
 */

const STORAGE_KEY = 'cove_credits';
const CREDITS_PER_WEEK = 10;
const TOKENS_PER_CREDIT = 1000;

function getCreditsData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveCreditsData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Initialize or refresh credits for the week
 */
export function initCredits() {
    const existing = getCreditsData();
    const now = Date.now();

    if (!existing || (now - existing.weekStart) > 7 * 24 * 60 * 60 * 1000) {
        // Start a new week
        saveCreditsData({
            credits: CREDITS_PER_WEEK,
            tokensUsed: 0,
            weekStart: now,
            isPro: existing?.isPro || false,
            maxCredits: CREDITS_PER_WEEK,
        });
    } else if (!existing.isPro) {
        // Migrate older local data that may have been created when free credits were configured as 0.
        const currentMax = typeof existing.maxCredits === 'number' ? existing.maxCredits : 0;
        if (currentMax !== CREDITS_PER_WEEK) {
            const next = {
                ...existing,
                maxCredits: CREDITS_PER_WEEK,
                credits: currentMax <= 0 ? Math.max(existing.credits || 0, CREDITS_PER_WEEK) : Math.min(existing.credits || 0, CREDITS_PER_WEEK),
            };
            saveCreditsData(next);
        }
    }

    return getCreditsData();
}

/**
 * Check if user has credits remaining
 */
export function hasCredits() {
    const data = initCredits();
    if (data.isPro) return true;
    return data.credits > 0;
}

/**
 * Get current credits info
 */
export function getCreditsInfo() {
    const data = initCredits();
    return {
        credits: data.credits,
        tokensUsed: data.tokensUsed,
        isPro: data.isPro,
        weekStart: data.weekStart,
        maxCredits: CREDITS_PER_WEEK,
        tokensPerCredit: TOKENS_PER_CREDIT,
    };
}

/**
 * Consume tokens (called after AI response)
 * @param {number} tokensUsed - Number of tokens consumed
 * @returns {boolean} - Whether credits were successfully consumed
 */
export function consumeTokens(tokensUsed) {
    const data = initCredits();
    if (data.isPro) return true;

    data.tokensUsed += tokensUsed;

    // Each credit = 1000 tokens
    const creditsConsumed = Math.floor(data.tokensUsed / TOKENS_PER_CREDIT);
    if (creditsConsumed > 0) {
        data.credits = Math.max(0, data.credits - creditsConsumed);
        data.tokensUsed = data.tokensUsed % TOKENS_PER_CREDIT;
    }

    saveCreditsData(data);
    return data.credits > 0;
}

/**
 * Upgrade to Pro
 */
export function upgradeToPro() {
    const data = initCredits();
    data.isPro = true;
    data.credits = Infinity;
    saveCreditsData(data);
}

/**
 * Detect user region and return LemonSqueezy payment URL
 */
export function getPaymentUrl() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const isIndonesia = tz.startsWith('Asia/Jakarta') || tz.startsWith('Asia/Makassar') || tz.startsWith('Asia/Jayapura') || tz.includes('Indonesia');

        // LemonSqueezy checkout URLs (placeholder — replace with actual store links)
        const LEMONSQUEEZY_STORE_ID = process.env.NEXT_PUBLIC_LEMONSQUEEZY_STORE_ID || 'cove-messenger';

        if (isIndonesia) {
            // Route to BCA via LemonSqueezy
            return `https://${LEMONSQUEEZY_STORE_ID}.lemonsqueezy.com/checkout/buy/cove-pro-id`;
        }
        // Global: PayPal via LemonSqueezy
        return `https://${LEMONSQUEEZY_STORE_ID}.lemonsqueezy.com/checkout/buy/cove-pro`;
    } catch {
        return 'https://cove-messenger.lemonsqueezy.com/checkout/buy/cove-pro';
    }
}
