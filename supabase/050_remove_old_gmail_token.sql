-- Remove the old personal Gmail token now that k.saleem@unzegroup.com handles everything
delete from google_oauth_tokens where user_email = 'khuram1901@gmail.com';
