import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import PageNotFound from './lib/PageNotFound';
import SelectROA from './pages/SelectROA';
import AdviceRecord from './pages/AdviceRecord';
import CommercialAdviceRecord from './pages/CommercialAdviceRecord';
import { AuthProvider } from '@/lib/AuthContext';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const AuthenticatedApp = () => (
  <>
    <SignedIn>
      <Routes>
        <Route path="/" element={<SelectROA />} />
        <Route path="/personal" element={<AdviceRecord />} />
        <Route path="/commercial" element={<CommercialAdviceRecord />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </SignedIn>
    <SignedOut>
      <RedirectToSignIn />
    </SignedOut>
  </>
);

function App() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ClerkProvider>
  );
}

export default App;