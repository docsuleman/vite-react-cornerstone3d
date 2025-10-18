import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import LoginPage from './LoginPage';
import TAVIApp from './TAVIApp';

const AuthenticatedApp: React.FC = () => {
  const { isAuthenticated, isLoading, signIn, signOut, resetPassword, changePassword, user } = useAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <LoginPage
        onLogin={signIn}
        onForgotPassword={resetPassword}
      />
    );
  }

  // Show main app if authenticated
  return (
    <TAVIApp
      onLogout={signOut}
      onChangePassword={changePassword}
      currentUserEmail={user?.email}
    />
  );
};

export default AuthenticatedApp;
