import { ref, computed } from 'vue'

export function useEmailValidation() {
  /**
   * Validates if a string is a valid email format
   * @param email - Email string to validate
   * @returns true if valid, false otherwise
   */
  const validateEmail = (email: string): boolean => {
    if (!email || !email.trim()) return true // Empty is valid (optional field)
    const normalized = email.trim()
    if (normalized.length > 254 || /\s/.test(normalized)) return false
    const atIndex = normalized.indexOf('@')
    if (atIndex <= 0 || atIndex !== normalized.lastIndexOf('@')) return false
    const domainDot = normalized.indexOf('.', atIndex + 1)
    return domainDot > atIndex + 1 && domainDot < normalized.length - 1
  }

  /**
   * Gets an error message for an invalid email
   * @param email - Email string to validate
   * @returns Error message if invalid, null if valid
   */
  const getEmailError = (email: string): string | null => {
    if (!email || !email.trim()) return null
    return validateEmail(email) ? null : 'Invalid email format'
  }

  /**
   * Creates a reactive email validation state
   * @param initialEmail - Initial email value
   */
  const createEmailValidator = (initialEmail: string = '') => {
    const email = ref(initialEmail)
    const touched = ref(false)
    
    const isValid = computed(() => validateEmail(email.value))
    const error = computed(() => touched.value ? getEmailError(email.value) : null)
    
    const setTouched = () => {
      touched.value = true
    }
    
    const reset = () => {
      email.value = ''
      touched.value = false
    }
    
    return {
      email,
      isValid,
      error,
      touched,
      setTouched,
      reset
    }
  }

  return {
    validateEmail,
    getEmailError,
    createEmailValidator
  }
}
