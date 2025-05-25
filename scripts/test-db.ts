import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    // Test database connection
    console.log('Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful');

    // Try to create a test user
    console.log('\nCreating test user...');
    const testUser = await prisma.user.create({
      data: {
        email: 'test@test.com',
        name: 'Test User',
        password: 'testpassword',
      },
    });
    console.log('✅ Test user created:', testUser);

    // Try to fetch all users
    console.log('\nFetching all users...');
    const allUsers = await prisma.user.findMany();
    console.log('✅ All users:', allUsers);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main(); 