import  { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { MongoClient, ServerApiVersion } from "mongodb";
let db;

async function connectDB() {
  if (db) return db;
  
  const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });
  
  await client.connect(); // Explicit connect call
  db = client.db();
  return db;
}

// export const authOptions =
// {
//     session: {
//     strategy: "jwt"
//   },
//   providers: [GoogleProvider({
//     clientId: process.env.GOOGLE_CLIENT_ID,
//     clientSecret:process.env.GOOGLE_CLIENT_SECRET
//   })],
//     secret: process.env.NEXTAUTH_SECRET,
// }
// const handler= NextAuth(authOptions)



const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user, account, profile }) {
      const db = await connectDB();
      const email = user.email;
      const name = user.name;
      const existingUser = await db.collection("users").findOne({ email });
      if (!existingUser) {
        await db.collection("users").insertOne({ email, name,role: "user" ,isProfileComplete:false});
      }
      return true;
    },
    async session({ session, token }) {
      const db = await connectDB();
      const dbUser = await db.collection("users").findOne({ email: session.user.email });

      session.user.id = dbUser.id;
      session.user.isProfileComplete = dbUser.isProfileComplete;
      session.user.role = dbUser.role;

      return session;
    },
  },
});
export {handler as POST, handler as GET}