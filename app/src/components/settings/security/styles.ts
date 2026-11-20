/** Shared Tailwind class strings for the sign-in and authentication settings UI. */
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2'
const base = `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`

export const ui = {
    primary: `${base} bg-emerald-600 text-white hover:bg-emerald-700`,
    secondary: `${base} border border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800`,
    ghost: `${base} text-gray-600 hover:bg-gray-100 hover:text-gray-900`,
    danger: `${base} text-rose-700 hover:bg-rose-50`,
    dangerSolid: `${base} bg-rose-600 text-white hover:bg-rose-700`,
    input: 'mt-1 block min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 transition-colors duration-200 placeholder:text-gray-400 focus-visible:border-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30 disabled:bg-gray-50',
    label: 'block text-sm font-bold text-gray-700',
    card: 'rounded-3xl border border-gray-100 bg-white p-6 shadow-sm',
    alert: 'flex flex-wrap items-center gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700',
    notice: 'rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800',
} as const
