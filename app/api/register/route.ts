import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    // Log the start of the request
    console.log("=== Registration API Called ===");

    // Verify database connection
    try {
      await prisma.$connect();
      console.log("✅ Database connection verified");
    } catch (dbError) {
      console.error("❌ Database connection failed:", dbError);
      throw new Error("Database connection failed");
    }

    const body = await request.json();
    const { email, name, password } = body;

    console.log("📝 Registration attempt:", { email, name });

    // Input validation
    if (!email || !name || !password) {
      console.log("❌ Missing fields:", { email, name, password: !!password });
      return new NextResponse(
        JSON.stringify({ error: "All fields are required" }), 
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return new NextResponse(
        JSON.stringify({ error: "Password must be at least 6 characters" }), 
        { status: 400 }
      );
    }

    if (!email.includes('@')) {
      return new NextResponse(
        JSON.stringify({ error: "Invalid email format" }), 
        { status: 400 }
      );
    }

    // Check for existing user
    try {
      const existingUser = await prisma.user.findUnique({
        where: {
          email,
        },
      });

      if (existingUser) {
        console.log("❌ User already exists:", email);
        return new NextResponse(
          JSON.stringify({ error: "Email already exists" }), 
          { status: 400 }
        );
      }
    } catch (findError) {
      console.error("❌ Error checking existing user:", findError);
      throw new Error("Failed to check existing user");
    }

    // Hash password
    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(password, 12);
      console.log("✅ Password hashed successfully");
    } catch (hashError) {
      console.error("❌ Password hashing failed:", hashError);
      throw new Error("Password hashing failed");
    }

    // Create user
    let user;
    try {
      user = await prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
        },
      });
      console.log("✅ User created successfully:", { id: user.id, email: user.email });
    } catch (createError) {
      console.error("❌ User creation failed:", createError);
      throw new Error("Failed to create user");
    }

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    
    console.log("=== Registration API Completed Successfully ===");
    return NextResponse.json({
      message: "User created successfully",
      user: userWithoutPassword
    });
  } catch (error) {
    console.error("❌ [REGISTER_ERROR]", error);
    return new NextResponse(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Internal server error" 
      }), 
      { status: 500 }
    );
  } finally {
    try {
      await prisma.$disconnect();
      console.log("✅ Database connection closed");
    } catch (disconnectError) {
      console.error("❌ Error disconnecting from database:", disconnectError);
    }
  }
} 