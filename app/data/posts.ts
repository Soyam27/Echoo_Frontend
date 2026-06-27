export interface Post {
  id: string
  gradientFrom: string
  gradientTo: string
  emoji: string
  caption: string
  likes: number
  comments: number
  time: string
}

export const POSTS: Post[] = [
  {
    id: "1",
    gradientFrom: "#1a0533",
    gradientTo: "#4a1080",
    emoji: "🚀",
    caption: "Excited to announce our latest product launch! Check the link in bio for more details.",
    likes: 1243,
    comments: 89,
    time: "2d ago",
  },
  {
    id: "2",
    gradientFrom: "#1a0a00",
    gradientTo: "#6b3000",
    emoji: "💫",
    caption: "Behind the scenes look at our creative process ✨ #design #startup",
    likes: 876,
    comments: 43,
    time: "4d ago",
  },
  {
    id: "3",
    gradientFrom: "#001a1a",
    gradientTo: "#004444",
    emoji: "🎯",
    caption: "Our biggest sale of the year starts NOW. Don't miss out on these deals!",
    likes: 2891,
    comments: 157,
    time: "1w ago",
  },
  {
    id: "4",
    gradientFrom: "#0a1a00",
    gradientTo: "#1a4000",
    emoji: "🌿",
    caption: "New collection dropping this Friday. Are you ready? 🔥 #newdrop",
    likes: 543,
    comments: 28,
    time: "1w ago",
  },
  {
    id: "5",
    gradientFrom: "#1a0a1a",
    gradientTo: "#4a0844",
    emoji: "✨",
    caption: "Thank you for 100k followers! We love every single one of you ❤️",
    likes: 4521,
    comments: 312,
    time: "2w ago",
  },
  {
    id: "6",
    gradientFrom: "#1a1000",
    gradientTo: "#4a3000",
    emoji: "🎨",
    caption: "Introducing our new brand identity. What do you think? Drop your thoughts below!",
    likes: 1876,
    comments: 203,
    time: "2w ago",
  },
  {
    id: "7",
    gradientFrom: "#00081a",
    gradientTo: "#001a40",
    emoji: "💡",
    caption: "5 tips to grow your business in 2025. Save this post for later!",
    likes: 3210,
    comments: 189,
    time: "3w ago",
  },
  {
    id: "8",
    gradientFrom: "#1a001a",
    gradientTo: "#3a0030",
    emoji: "🎉",
    caption: "We're hiring! Join our amazing team and shape the future. Link in bio.",
    likes: 987,
    comments: 76,
    time: "3w ago",
  },
  {
    id: "9",
    gradientFrom: "#001a0a",
    gradientTo: "#003020",
    emoji: "🏆",
    caption: "Just won the industry award for best innovation! Incredibly grateful. 🙏",
    likes: 5421,
    comments: 429,
    time: "1mo ago",
  },
]
