import { Toaster } from "@/components/ui/toaster";
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import SelectROA from './pages/SelectROA';
import AdviceRecord from './pages/AdviceRecord';
import CommercialAdviceRecord from './pages/CommercialAdviceRecord';
import Login from './pages/Login';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

function AuthGate({ children }) {
  const { isAuthenticated, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-hrs-blue via-hrs-blue2 to-[#0a1628] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/20 border-t-hrs-orange rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return children;
}

function App() {
  return (
    <AuthProvider>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthGate>
            <Routes>
              <Route path="/" element={<SelectROA />} />
              <Route path="/personal" element={<AdviceRecord />} />
              <Route path="/commercial" element={<CommercialAdviceRecord />} />
              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </AuthGate>
        </Router>
        <Toaster />
    </AuthProvider>
  );
}

export default App;
