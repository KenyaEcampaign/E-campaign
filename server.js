import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import path from "path";
import dotenv from "dotenv";
import crypto from "crypto";
import { fileURLToPath } from "url";

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./utils/mailer.js";

dotenv.config();


const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   STATIC FRONTEND
========================= */
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   SUPABASE
========================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
async function requireAdmin(admin_id) {
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', admin_id)
    .single();

  return data && data.role === 'admin';
}

/* =========================
   TEST ROUTES
========================= */
app.get("/", (req, res) => {
  res.send("Civic Platform Backend Running");
});

app.get("/env-test", (req, res) => {
  res.json({
    hasUrl: !!process.env.SUPABASE_URL,
    hasKey: !!process.env.SUPABASE_SERVICE_KEY
  });
});

// DATABASE TEST ROUTE
app.get('/test-db', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .limit(5);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});
app.post("/register", async (req, res) => {
  const { username, email, password, role } = req.body;

  const password_hash = await bcrypt.hash(password, 10);
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  const { error } = await supabase.from("users").insert([{
    username,
    email,
    password_hash,
    role,
    email_verified: false,
    verify_code: code,
    verify_code_expires: new Date(Date.now() + 15 * 60 * 1000)
  }]);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  await sendEmail(
    email,
    "Verify your Kenya E-Campaign account 🇰🇪",
    `
      <h3>Welcome to Kenya E-Campaign Platform</h3>
      <p>Your verification code is:</p>
      <h2>${code}</h2>
      <p>This code expires in 15 minutes.</p>
    `
  );

  res.json({ success: true });
});

app.post("/verify-email", async (req, res) => {
  const { email, code } = req.body;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (
    !user ||
    user.verify_code !== code ||
    new Date() > new Date(user.verify_code_expires)
  ) {
    return res.status(400).json({ error: "Invalid or expired code" });
  }

  await supabase.from("users").update({
    email_verified: true,
    verify_code: null,
    verification_code_expires: null
  }).eq("email", email);

  res.json({ success: true });
});


// USER LOGIN
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Basic validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Find user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is active
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is suspended' });
    }

    // Compare passwords
  const passwordMatch = await bcrypt.compare(password, user.password_hash);

if (!passwordMatch) {
  return res.status(401).json({ error: "Invalid email or password" });
}

if (!user.email_verified) {
  return res.json({ error: "Please verify your email first" });
}

    // Remove password before sending response
    delete user.password_hash;

    res.json({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role
});


  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (!user) {
    return res.json({ error: "Email not found" });
  }

  await supabase.from("users").update({
    reset_code: code,
    reset_code_expires: new Date(Date.now() + 15 * 60 * 1000)
  }).eq("email", email);

  await sendEmail(
    email,
    "Reset your Kenya E-Campaign password 🇰🇪",
    `
      <p>Your reset code:</p>
      <h2>${code}</h2>
      <p>Expires in 15 minutes.</p>
    `
  );

  res.json({ success: true });
});


app.post("/reset-password", async (req, res) => {
  const { email, code, password } = req.body;

  const { data } = await supabase.from("users").select("*").eq("email", email).single();

  if (!data || data.reset_code !== code || new Date() > new Date(data.reset_code_expires))
    return res.json({ error: "Invalid or expired code" });

  const hash = await bcrypt.hash(password, 10);

  await supabase.from("users").update({
    password_hash: hash,
    reset_code: null,
    reset_code_expires: null
  }).eq("email", email);

  res.json({ success: true });
});

app.post('/apply-politician', async (req, res) => {
  const {
    user_id,
    full_name,
    seat,
    county,
    constituency,
    party,
    motivation,
    fee
  } = req.body;

  if (!user_id || !full_name || !seat || !motivation || !fee) {
  return res.status(400).json({ error: "Missing required fields" });
}

if (seat !== "President" && !county) {
  return res.status(400).json({ error: "County is required for this seat" });
}


  try {
    // Prevent duplicate application
    const { data: existing } = await supabase
      .from('politician_applications')
      .select('id')
      .eq('user_id', user_id)
      .single();

    if (existing) {
      return res.status(400).json({
        error: "You have already submitted an application"
      });
    }

    const { error } = await supabase
      .from('politician_applications')
      .insert([{
        user_id,
        full_name,
        seat,
        county,
        constituency,
        party,
        motivation,
        fee,
        status: 'pending'
      }]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      message: "Application submitted. Please wait for admin approval."
    });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
app.get("/admin/applications", async (req, res) => {
  const { data, error } = await supabase
    .from("politician_applications")
    .select(`
      id,
      full_name,
      seat,
      county,
      party,
      fee,
      status,
      user_id,
      users(email, username)
    `)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/admin/approve-politician', async (req, res) => {
  const { application_id, admin_id } = req.body;

  if (!await requireAdmin(admin_id)) {
    return res.status(403).json({ error: "Admin only" });
  }

  const { data: appData } = await supabase
    .from('politician_applications')
    .select('*')
    .eq('id', application_id)
    .single();

  if (!appData || appData.status !== 'pending') {
    return res.status(400).json({ error: "Invalid application" });
  }

  await supabase.from('users')
    .update({ role: 'politician' })
    .eq('id', appData.user_id);

  await supabase.from('politician_profiles').upsert({
    user_id: appData.user_id,
    full_name: appData.full_name,
    seat: appData.seat,
    county: appData.county,
    constituency: appData.constituency,
    party: appData.party,
    bio: appData.motivation,
    is_verified: true
  });

  await supabase.from('politician_applications')
    .update({ status: 'approved' })
    .eq('id', application_id);

  res.json({ message: "Approved" });
});
app.post('/admin/reject-politician', async (req, res) => {
  const { application_id, admin_id } = req.body;

  if (!await requireAdmin(admin_id)) {
    return res.status(403).json({ error: "Admin only" });
  }

  await supabase
    .from('politician_applications')
    .update({ status: 'rejected' })
    .eq('id', application_id);

  res.json({ message: "Rejected" });
});
// GET ALL POLITICIAN APPLICATIONS (PUBLIC VIEW)
app.get("/politicians/all", async (req, res) => {
  const { data: apps, error } = await supabase
    .from("politician_applications")
    .select(`
      id,
      user_id,
      full_name,
      seat,
      county,
      constituency,
      party,
      status
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // attach profile_id manually
  const result = await Promise.all(
    apps.map(async (app) => {
      if (app.status !== "approved") {
        return { ...app, profile_id: null };
      }

      const { data: profile } = await supabase
        .from("politician_profiles")
        .select("id")
        .eq("user_id", app.user_id)
        .single();

      return {
        ...app,
        profile_id: profile?.id || null
      };
    })
  );

  res.json(result);
});



 
app.post('/politician/add-achievement', async (req, res) => {
  const { user_id, title, description } = req.body;

  const { data: profile } = await supabase
    .from('politician_profiles')
    .select('id')
    .eq('user_id', user_id)
    .single();

  await supabase.from('achievements').insert({
    politician_id: profile.id,
    title,
    description
  });

  res.json({ message: "Achievement added" });
});

app.get("/admin/users", async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, username, email, role, status")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get("/admin/user/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "User not found" });
  res.json(data);
});

// CREATE MANIFESTO (POLITICIAN ONLY)
app.post('/manifesto', async (req, res) => {
  const { user_id, category, content } = req.body;

  const allowedCategories = [
    'Youth & Jobs',
    'Education',
    'Health',
    'Economy',
    'Governance'
  ];

  if (!user_id || !category || !content) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid manifesto category' });
  }

  try {
    // 1. Confirm user is a politician
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .single();

    if (!user || user.role !== 'politician') {
      return res.status(403).json({ error: 'Only politicians can post manifestos' });
    }

    // 2. Get politician profile
    const { data: profile } = await supabase
      .from('politician_profiles')
      .select('id')
      .eq('user_id', user_id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'Politician profile not found' });
    }

    // 3. Insert manifesto
    const { error } = await supabase
      .from('manifestos')
      .insert([
        {
          politician_id: profile.id,
          category,
          content
        }
      ]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Manifesto posted successfully' });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// GET ALL MANIFESTOS (PUBLIC)
app.get('/manifestos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('manifestos')
      .select(`
        id,
        category,
        content,
        created_at,
        politician_profiles (
          full_name,
          seat,
          county,
          constituency,
          party
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST COMMENT (GENERIC TARGET SYSTEM)
app.post('/comment', async (req, res) => {
  const { user_id, target_id, content } = req.body;

  if (!user_id || !target_id || !content) {
    return res.status(400).json({ error: 'All fields required' });
  }

  // Safety filter (basic, extend later)
  const bannedWords = ['kill', 'hate', 'tribe', 'idiot'];
  const text = content.toLowerCase();

  if (bannedWords.some(word => text.includes(word))) {
    return res.status(400).json({ error: 'Comment violates community rules' });
  }

  try {
    // Confirm user exists
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', user_id)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Insert comment
    const { error } = await supabase
      .from('comments')
      .insert([
        {
          user_id,
          target_type: 'manifesto',
          target_id,
          content
        }
      ]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Comment posted successfully' });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET COMMENTS FOR A MANIFESTO (PUBLIC)
app.get('/comments/:target_id', async (req, res) => {
  const { target_id } = req.params;

  try {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        id,
        content,
        created_at,
        users (
          username,
          role
        )
      `)
      .eq('target_type', 'manifesto')
      .eq('target_id', target_id)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// RATE MANIFESTO (1–5)
app.post('/rate', async (req, res) => {
  const { user_id, target_id, rating } = req.body;

  if (!user_id || !target_id || !rating) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  try {
    // Upsert rating (insert or update)
    const { error } = await supabase
      .from('ratings')
      .upsert([
        {
          user_id,
          target_type: 'manifesto',
          target_id,
          rating
        }
      ]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Rating saved' });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// GET MANIFESTO RATING SUMMARY
app.get('/ratings/:target_id', async (req, res) => {
  const { target_id } = req.params;

  try {
    const { data, error } = await supabase
      .from('ratings')
      .select('rating')
      .eq('target_type', 'manifesto')
      .eq('target_id', target_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (data.length === 0) {
      return res.json({ average: 0, count: 0 });
    }

    const total = data.reduce((sum, r) => sum + r.rating, 0);
    const avg = (total / data.length).toFixed(1);

    res.json({
      average: avg,
      count: data.length
    });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// POLITICIAN PROFILE PAGE
app.get('/politician/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: profile, error: profileError } = await supabase
      .from('politician_profiles')
      .select(`
        id,
        user_id,
        full_name,
        seat,
        county,
        constituency,
        party,
        bio
      `)
      .eq('id', id)
      .single();

    if (profileError) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { data: manifestos } = await supabase
      .from('manifestos')
      .select('id, category, content, created_at')
      .eq('politician_id', id)
      .order('created_at', { ascending: false });

    const { data: achievements } = await supabase
      .from('achievements')
      .select('title, description, created_at')
      .eq('politician_id', id);

    const { data: promises } = await supabase
      .from('promises')
      .select('content, created_at')
      .eq('politician_id', id);

    res.json({
      profile,
      manifestos,
      achievements,
      promises
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load politician profile' });
  }
});


// GET ALL APPROVED POLITICIANS (PUBLIC)
app.get("/politicians", async (req, res) => {
  const { data, error } = await supabase
    .from("politician_profiles")
    .select(`
      id,
      user_id,
      full_name,
      seat,
      county,
      constituency,
      party,
      bio
    `)
    .eq("is_verified", true)
    .order("full_name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/politician/update-profile', async (req, res) => {
  const { politician_id, promises, achievements, campaign } = req.body;

  const { error } = await supabase
    .from('politician_profiles')
    .update({
      promises,
      achievements,
      campaign
    })
    .eq('id', politician_id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Profile updated' });
});

// GET LOGGED-IN POLITICIAN PROFILE
app.get("/my-politician-profile/:user_id", async (req, res) => {
  const { user_id } = req.params;

  const { data, error } = await supabase
    .from("politician_profiles")
    .select("*")
    .eq("user_id", user_id)
    .single();

  if (error) {
    return res.status(404).json({ error: "Profile not found" });
  }

  res.json(data);
});

// POST GROUND UPDATE
app.post('/ground-updates', async (req, res) => {
  const { user_id, location, category, content } = req.body;

  if (!user_id || !location || !category || !content) {
    return res.status(400).json({ error: "All fields required" });
  }

  try {
    const { error } = await supabase
      .from('ground_updates')
      .insert([{ user_id, location, category, content }]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: "Update posted" });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});
// GET GROUND UPDATES
app.get("/ground-updates", async (req, res) => {
  const { data, error } = await supabase
    .from("ground_updates")
    .select(`
  id,
  location,
  category,
  content,
  created_at,
  users(username)
`)

    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
});

app.get("/ground-likes/:id", async (req, res) => {
  const { count } = await supabase
    .from("ground_likes")
    .select("*", { count: "exact", head: true })
    .eq("ground_id", req.params.id);

  res.json({ count });
});

app.get("/ground-comments-count/:id", async (req, res) => {
  const { count } = await supabase
    .from("ground_comments")
    .select("*", { count: "exact", head: true })
    .eq("ground_id", req.params.id);

  res.json({ count });
});

app.get("/ground-reposts-count/:id", async (req, res) => {
  const { count } = await supabase
    .from("ground_reposts")
    .select("*", { count: "exact", head: true })
    .eq("ground_id", req.params.id);

  res.json({ count });
});

app.post('/ground-like', async (req, res) => {
  const { user_id, ground_id } = req.body;

  if (!user_id || !ground_id) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const { error } = await supabase
    .from('ground_likes')
    .upsert([{ user_id, ground_id }]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ message: 'Liked' });
});
app.get("/ground-comments/:id", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("ground_comments")
    .select("content, created_at, users(username)")
    .eq("ground_id", id)
    .order("created_at", { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
});

app.post('/ground-repost', async (req, res) => {
  const { user_id, ground_id } = req.body;

  if (!user_id || !ground_id) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const { data: original } = await supabase
    .from('ground_updates')
    .select('*')
    .eq('id', ground_id)
    .single();

  const { error } = await supabase.from('ground_updates').insert([
    {
      user_id,
      location: original.location,
      category: original.category,
      content: original.content,
      repost_of: ground_id
    }
  ]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ message: 'Reposted' });
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
