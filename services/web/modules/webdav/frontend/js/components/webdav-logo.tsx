function WebdavLogo({ size = 32 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <rect width="40" height="40" rx="8" fill="#2196F3" />
            <path
                d="M12 15V25C12 25.5523 12.4477 26 13 26H27C27.5523 26 28 25.5523 28 25V15"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
            />
            <path
                d="M13 15L10 12H16L13 9V15Z"
                fill="#1976D2"
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
            />
            <path
                d="M27 15L30 12H24L27 9V15Z"
                fill="#1976D2"
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
            />
            <path
                d="M20 15V21"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
            />
            <path
                d="M16.5 18.5H23.5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    )
}

export default WebdavLogo