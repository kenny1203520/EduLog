-- EduLog Initial Schema (Consolidated)
-- Includes: Students, Contacts, Schools, Credentials, Reports

-- 1. Students Table
create table if not exists students (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- Basic Info
  name text not null,
  grade text,
  notes text,
  
  -- Extended Details
  gov_id text,
  email text,
  phone text,
  residence_address text,
  mailing_address text,
  orange_apple_id text,
  
  user_id uuid references auth.users default auth.uid()
);

alter table students enable row level security;

create policy "Users can view their own students" on students for select using (auth.uid() = user_id);
create policy "Users can insert their own students" on students for insert with check (auth.uid() = user_id);
create policy "Users can update their own students" on students for update using (auth.uid() = user_id);
create policy "Users can delete their own students" on students for delete using (auth.uid() = user_id);


-- 2. Student Contacts (One-to-Many)
create table if not exists student_contacts (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  
  name text not null,
  relation text, -- e.g. Father, Mother
  phone text,
  email text,    -- Added as requested
  
  user_id uuid references auth.users default auth.uid() not null
);

alter table student_contacts enable row level security;
create policy "Users can manage their own student contacts" on student_contacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- 3. Student Schools (One-to-Many)
create table if not exists student_schools (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  
  name text not null,
  status text, -- e.g. Graduated, Attending
  
  user_id uuid references auth.users default auth.uid() not null
);

alter table student_schools enable row level security;
create policy "Users can manage their own student schools" on student_schools for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- 4. Student Credentials (One-to-Many)
-- Stores external accounts like Roblox, Minecraft, AnyDesk, etc.
create table if not exists student_credentials (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  
  platform text not null, -- 'Orange Apple', 'Roblox', 'Minecraft', 'Anydesk', etc.
  username text,
  password text,
  url text,
  
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users default auth.uid() not null
);

alter table student_credentials enable row level security;
create policy "Users can manage their own student credentials" on student_credentials for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- 5. Reports Table
create table if not exists reports (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  content text default '',
  date date default CURRENT_DATE,
  
  student_id uuid references students(id) on delete cascade not null,
  user_id uuid references auth.users default auth.uid() not null
);

alter table reports enable row level security;

create policy "Users can view their own reports" on reports for select using (auth.uid() = user_id);
create policy "Users can insert their own reports" on reports for insert with check (auth.uid() = user_id);
create policy "Users can update their own reports" on reports for update using (auth.uid() = user_id);
create policy "Users can delete their own reports" on reports for delete using (auth.uid() = user_id);
