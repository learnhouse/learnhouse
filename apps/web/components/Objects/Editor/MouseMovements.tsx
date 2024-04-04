import { m, motion } from "framer-motion";
import React from 'react'

interface User {
    user_uuid: string;
    first_name: string;
    last_name: string;
}

interface Movement {
    user: User;
    mouseX: number;
    mouseY: number;
    color: string;
    onlinePageInstanceID: string;
}

interface MouseMovementsProps {
    movements: Record<string, Movement>;
    onlinePageInstanceID: string;
}

function MouseMovements({ movements, onlinePageInstanceID }: MouseMovementsProps): JSX.Element {
    return (
        <div>
            {Object.keys(movements).map((key) => (
                movements[key].onlinePageInstanceID !== onlinePageInstanceID && (<motion.div
                    key={key}
                    className="flex -space-x-2"
                    style={{
                        position: "fixed",
                        zIndex: 10000,
                    }}
                    initial={{ x: 0, y: 0 }}
                    animate={{ x: movements[key].mouseX, y: movements[key].mouseY }}
                    transition={{
                        type: "spring",
                        damping: 30,
                        mass: 0.8,
                        stiffness: 350,
                    }}
                >
                    <CursorSvg color={movements[key].color} />
                    <div
                        style={{ backgroundColor: movements[key].color }}
                        className={`px-3 h-fit py-0.5 rounded-full font-bold text-[11px] shadow-sm text-black`}>{movements[key].user.first_name} {movements[key].user.last_name}</div>
                </motion.div>)

            ))}
        </div>
    );
}

function CursorSvg({ color }: { color: string }) {
    return (
        <svg width="32" height="44" viewBox="0 0 24 36" fill="none">
            <path
                fill={color}
                d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export default MouseMovements;