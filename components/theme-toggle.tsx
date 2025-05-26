"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { setTheme } = useTheme()
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Check for dark mode using window.matchMedia
  useEffect(() => {
    // Initialize based on document class or media query
    const isDark =
      document.documentElement.classList.contains("dark") ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
    setIsDarkMode(isDark)

    // Listen for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          setIsDarkMode(document.documentElement.classList.contains("dark"))
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })

    return () => observer.disconnect()
  }, [])

  // Simple toggle function that directly sets the theme
  const toggleTheme = () => {
    const newTheme = isDarkMode ? "light" : "dark"
    setTheme(newTheme)
    setIsDarkMode(!isDarkMode)
  }

  return (
    <Button variant="ghost" className="w-full justify-start gap-2 text-sm font-normal" onClick={toggleTheme}>
      {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
      <span>{isDarkMode ? "Light mode" : "Dark mode"}</span>
    </Button>
  )
}
