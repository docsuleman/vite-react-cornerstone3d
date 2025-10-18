# Supabase Authentication Setup Guide

This guide will help you configure Supabase authentication for the QuanTAVI application.

## What You Need to Provide

To enable authentication in the application, you need to provide the following information from your Supabase project:

### 1. **Supabase Project URL**
- This is your unique Supabase project URL
- Format: `https://[your-project-id].supabase.co`
- Example: `https://xyzabc123.supabase.co`

### 2. **Supabase Anon/Public Key**
- This is the public anonymous key for your Supabase project
- It's safe to use in client-side code
- It's a long JWT token string
- Example: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## How to Get These Values

### Step 1: Create a Supabase Account
1. Go to https://supabase.com
2. Sign up for a free account
3. Create a new project

### Step 2: Find Your Project Credentials
1. Go to your Supabase project dashboard
2. Click on the **Settings** icon (gear icon) in the left sidebar
3. Select **API** from the settings menu
4. You will see:
   - **Project URL** - Copy this value
   - **Project API keys** section:
     - **anon/public** key - Copy this value (NOT the service_role key)

### Step 3: Configure the Application
1. In your project root directory, create a file named `.env`
2. Copy the contents from `.env.example`
3. Replace the placeholder values with your actual Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

4. Save the file

### Step 4: Enable Email Authentication in Supabase
1. In your Supabase dashboard, go to **Authentication** → **Providers**
2. Make sure **Email** is enabled
3. Configure email settings:
   - **Enable email confirmations** (optional - recommended for production)
   - **Enable email change confirmations** (optional)
   - Set **Site URL** to your application URL (e.g., `http://localhost:5173` for development)

### Step 5: Create User Accounts
You have two options:

#### Option A: Manual User Creation (Recommended for Testing)
1. Go to **Authentication** → **Users** in Supabase dashboard
2. Click **Add user** → **Create new user**
3. Enter email and password
4. Click **Create user**

#### Option B: Enable Sign-ups (For Production)
1. Go to **Authentication** → **Settings**
2. Enable **Enable email signup**
3. Users can now create accounts from the login page

## Features Enabled

Once configured, the following authentication features will work:

1. ✅ **Login** - Users can sign in with email and password
2. ✅ **Logout** - Users can sign out from the application
3. ✅ **Password Reset** - Users can request password reset emails
4. ✅ **Change Password** - Logged-in users can change their password
5. ✅ **Session Management** - Automatic session refresh and persistence

## Security Notes

- **Never commit your `.env` file to version control** - It's already added to `.gitignore`
- The `anon/public` key is safe for client-side use (it has limited permissions)
- **Never use the `service_role` key** in client-side code (it has full admin permissions)
- For production, enable email confirmation to verify user email addresses

## Testing the Authentication

After setup:

1. Start your development server: `npm run dev`
2. The application will show a login page
3. Use the credentials you created in Supabase to login
4. Access settings → Security tab to change password or logout

## Troubleshooting

### "Supabase client not initialized" Error
- Check that `.env` file exists and contains the correct values
- Restart the development server after creating/updating `.env`
- Verify the environment variable names start with `VITE_`

### Login Fails with "Invalid Credentials"
- Verify the user exists in Supabase Authentication → Users
- Check that the password is correct
- Make sure email authentication is enabled in Supabase

### Password Reset Email Not Sent
- Configure email settings in Supabase Authentication → Settings
- For development, check Supabase dashboard → Authentication → Logs
- For production, configure a custom SMTP server (optional)

## Next Steps

After authentication is working:

1. Configure row-level security (RLS) policies in Supabase for your database tables
2. Set up user roles and permissions
3. Configure email templates for password reset and confirmations
4. Add profile management features

## Support

For more information about Supabase authentication:
- Documentation: https://supabase.com/docs/guides/auth
- Examples: https://supabase.com/docs/guides/auth/auth-email
