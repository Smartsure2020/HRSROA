import { useAuth } from '@/lib/AuthContext';
import { LogOut } from 'lucide-react';

export default function AppHeader({ title = "Advice Record – New Personal Insurance" }) {
  const { user, logout } = useAuth();

  return (
    <header className="bg-card border-b-[3px] border-hrs-orange px-4 sm:px-8 py-3 flex items-center justify-between sticky top-0 z-50 shadow-[0_2px_16px_rgba(55,83,164,0.12)]">
      <div className="flex items-center gap-3">
        <img
          src="https://hrsinsurance.co.za/wp-content/uploads/2020/07/cropped-HRS_Logo-1-118x52.png"
          alt="Holistic Risk Services"
          className="h-11 w-auto block"
        />
        <span className="text-hrs-muted text-[0.72rem] tracking-[0.12em] uppercase hidden sm:block">
          FSP 28582
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-hrs-blue text-[0.8rem] tracking-[0.08em] uppercase opacity-70 hidden sm:block">
          {title}
        </span>
        {user && (
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-hrs-muted/60 hover:text-hrs-blue text-xs transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{user.name}</span>
          </button>
        )}
      </div>
    </header>
  );
}