'use client'

import { useState } from 'react'
import { LoginForm } from './login-form'
import { SignupForm } from './signup-form'

export function AuthModal() {
  const [isLogin, setIsLogin] = useState(true)

  const toggleMode = () => setIsLogin(!isLogin)

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {isLogin ? (
        <LoginForm onToggleMode={toggleMode} />
      ) : (
        <SignupForm onToggleMode={toggleMode} />
      )}
    </div>
  )
}