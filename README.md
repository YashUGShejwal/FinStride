# FinStride - Stock Portfolio Tracker

FinStride is a responsive web application designed to help users track, manage, and analyze their stock market investments in one place.

![FinStride Preview](public/images/finstride-preview.png)

## Features

- **User Authentication:** Secure login and registration with email or social providers
- **Portfolio Management:** Add, update, and delete stocks in your personalized portfolio
- **Real-time Data:** Track stock prices and portfolio performance with up-to-date information
- **Visual Analytics:** Interactive charts and graphs to visualize your investments
- **Responsive Design:** Optimized for both desktop and mobile devices
- **Dark/Light Mode:** Switch between dark and light themes based on your preference

## Tech Stack

- **Frontend:** Next.js (React), TypeScript, TailwindCSS
- **Authentication:** NextAuth.js (planned)
- **Data Visualization:** Canvas API (custom charts)
- **State Management:** React Context API
- **Styling:** TailwindCSS with custom components
- **Icons:** Heroicons
- **API Integration:** Planned integration with financial data providers

## Getting Started

### Prerequisites

- Node.js (v14 or newer)
- npm or yarn

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/finstride.git
   cd finstride
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Run the development server:
   ```
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Project Structure

```
/app                  # Main application code
  /components         # Reusable UI components
  /api                # API routes and handlers
  /lib                # Utility functions and shared logic
  /models             # Data models
  /utils              # Helper functions
  /auth               # Authentication-related pages
  /dashboard          # Dashboard and portfolio management pages
  /styles             # Global styles
/public               # Static assets
  /images             # Images and icons
```

## Development Roadmap

- [x] Initial project setup with Next.js and TailwindCSS
- [x] Landing page design
- [x] Authentication UI (login/signup)
- [x] Dashboard layout and portfolio overview
- [x] Individual stock detail page
- [ ] Real stock data API integration
- [ ] User authentication implementation
- [ ] Portfolio CRUD operations
- [ ] Advanced analytics and reporting
- [ ] Mobile optimizations
- [ ] Performance enhancements
- [ ] Testing suite

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [Next.js](https://nextjs.org/)
- [TailwindCSS](https://tailwindcss.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [React](https://reactjs.org/)