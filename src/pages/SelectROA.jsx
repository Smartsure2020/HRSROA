import { useNavigate } from 'react-router-dom';
import { Building2, User, LogOut } from 'lucide-react';
import logoUrl from '../assets/hrs-logo.png';
import { useAuth } from '@/lib/AuthContext';

export default function SelectROA() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-hrs-blue via-hrs-blue2 to-[#0a1628] flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-white rounded-xl px-6 py-4 shadow-2xl mb-5">
          <img src={logoUrl} alt="HRS Insurance" className="h-12" />
        </div>
        <h1 className="font-heading text-white text-[1.6rem] text-center leading-tight">
          Record of Advice
        </h1>
        <p className="text-white/60 text-[0.85rem] mt-1 text-center">
          Holistic Risk Services (Pty) Ltd &nbsp;|&nbsp; FSP No. 28582
        </p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-2xl">
        <button
          onClick={() => navigate('/personal')}
          className="group bg-white/10 hover:bg-white/20 border border-white/20 hover:border-hrs-orange rounded-2xl p-7 text-left transition-all duration-200 hover:shadow-2xl hover:-translate-y-1"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl bg-hrs-orange/20 flex items-center justify-center group-hover:bg-hrs-orange/30 transition-colors">
              <User className="w-5 h-5 text-hrs-orange" />
            </div>
            <span className="font-heading text-white text-[1.05rem]">Personal Lines</span>
          </div>
          <p className="text-white/60 text-[0.8rem] leading-relaxed">
            New business ROA for individual clients — buildings, contents, vehicles, all risks and personal liability.
          </p>
          <div className="mt-5 flex items-center gap-1.5 text-hrs-orange text-[0.78rem] font-semibold">
            Start Personal ROA
            <span className="group-hover:translate-x-1 transition-transform inline-block">→</span>
          </div>
        </button>

        <button
          onClick={() => navigate('/commercial')}
          className="group bg-white/10 hover:bg-white/20 border border-white/20 hover:border-hrs-orange rounded-2xl p-7 text-left transition-all duration-200 hover:shadow-2xl hover:-translate-y-1"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl bg-hrs-orange/20 flex items-center justify-center group-hover:bg-hrs-orange/30 transition-colors">
              <Building2 className="w-5 h-5 text-hrs-orange" />
            </div>
            <span className="font-heading text-white text-[1.05rem]">Commercial Lines</span>
          </div>
          <p className="text-white/60 text-[0.8rem] leading-relaxed">
            New business ROA for commercial clients — business assets, liability, motor, professional indemnity and more.
          </p>
          <div className="mt-5 flex items-center gap-1.5 text-hrs-orange text-[0.78rem] font-semibold">
            Start Commercial ROA
            <span className="group-hover:translate-x-1 transition-transform inline-block">→</span>
          </div>
        </button>
      </div>

      <div className="mt-10 flex flex-col items-center gap-2">
        <p className="text-white/30 text-[0.72rem] text-center">
          New Personal Insurance &nbsp;|&nbsp; New Commercial Insurance
        </p>
        {user && (
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-white/30 hover:text-white/60 text-[0.72rem] transition-colors"
          >
            <LogOut className="w-3 h-3" />
            Sign out ({user.name})
          </button>
        )}
      </div>
    </div>
  );
}