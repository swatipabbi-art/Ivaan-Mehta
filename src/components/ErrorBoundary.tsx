import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('FormLab ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendlyMessage = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
        if (parsed?.error) {
          friendlyMessage = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
        }
      } catch {
        // Keep raw message if not JSON
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center flex flex-col items-center gap-4">
            <div className="h-11 w-11 rounded-full bg-rose-50 flex items-center justify-center text-rose-600">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Something went wrong
              </h1>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed break-words">
                {friendlyMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reload FormLab</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
