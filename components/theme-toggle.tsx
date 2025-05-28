"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState, memo, useCallback } from "react"
import { Button } from "@/components/ui/button"

export const ThemeToggle = memo(function ThemeToggle() {
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

  if (!mounted) {
    return (
      <Button variant="ghost" className="w-full justify-start gap-2 text-sm font-normal">
        <Moon size={16} />
        <span>Theme</span>
      </Button>
    )
  }

  const isDarkMode = theme === 'dark'

  return (
    <Button variant="ghost" className="w-full justify-start gap-2 text-sm font-normal" onClick={toggleTheme}>
      {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
      <span>{isDarkMode ? "Light mode" : "Dark mode"}</span>
    </Button>
  )
})
