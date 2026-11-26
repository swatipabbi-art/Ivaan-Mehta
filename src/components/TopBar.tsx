import { Camera, LogIn, LogOut, ShieldCheck, VideoOff } from 'lucide-react';
import { AppView } from '../types/exercise';

interface TopBarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  isCameraActive: boolean;
  onToggleCamera: () => void;
  userEmail: string | null;
  isOwner: boolean;
  authReady: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: 'coach', label: 'Live Coach' },
  { id: 'library', label: 'Exercise Library' },
  { id: 'classroom', label: 'Classroom' },
  { id: 'ai_coach', label: 'AI Coach' },
  { id: 'history', label: 'Session Log' },
  { id: 'calibration', label: 'Setup Guide' },
];

export function TopBar({
  activeView,
  onNavigate,
  isCameraActive,
  onToggleCamera,
  userEmail,
  isOwner,
  authReady,
  onSignIn,
  onSignOut,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('coach')}
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          FormLab
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden lg:flex items-center gap-6"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded ${
                  isActive
                    ? 'text-slate-900'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Account status + Primary Camera CTA */}
        <div className="flex items-center gap-3 shrink-0">
          {authReady && (
            userEmail ? (
              <button
                type="button"
                onClick={onSignOut}
                title={`Signed in as ${userEmail}. Click to sign out.`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isOwner && (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                )}
                <span className="max-w-[130px] truncate">
                  {isOwner ? 'Owner · Free Pro' : userEmail.split('@')[0]}
                </span>
                <LogOut className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogIn className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Sign In</span>
              </button>
            )
          )}

          <button
            type="button"
            onClick={onToggleCamera}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              isCameraActive
                ? 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-900'
                : 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600'
            }`}
          >
            {isCameraActive ? (
              <>
                <VideoOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Stop Camera</span>
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Start Camera</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mobile & tablet compact secondary nav row */}
      <nav
        aria-label="Mobile navigation"
        className="flex lg:hidden items-center justify-between gap-2 overflow-x-auto border-t border-slate-100 px-4 py-1.5"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 rounded transition-colors ${
                isActive
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
