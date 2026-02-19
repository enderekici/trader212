'use client';
import { BookOpen } from 'lucide-react';

export function SetupGuideButton() {
  function handleClick() {
    localStorage.removeItem('setup_complete');
    localStorage.setItem('setup_force', 'true');
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <BookOpen className="h-4 w-4" />
      Setup Guide
    </button>
  );
}
