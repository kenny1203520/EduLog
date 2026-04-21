import { ref, computed } from 'vue'

export function useEmailValidation() {
  /**
   * Validates if a string is a valid email format
   * @param email - Email string to validate
   * @returns true if valid, false otherwise
   */
  const validateEmail = (email: string): boolean => {
    if (!email || !email.trim()) return true // Empty is valid (optional field)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email.trim())
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
