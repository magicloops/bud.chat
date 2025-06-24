"use client"

import { useTheme } from "next-themes"
import { useEffect, useState, useCallback } from "react"

export function useThemeToggle() {
  const { setTheme, theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  // Simple toggle function that directly sets the theme
  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const isDarkMode = mounted ? theme === 'dark' : false
  
  return {
    toggleTheme,
    isDarkMode,
    mounted,
    currentTheme: theme
  }
}
