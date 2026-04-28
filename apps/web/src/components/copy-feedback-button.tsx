"use client";

import { useEffect, useRef, useState } from "react";
import { App, Button, Tooltip, theme } from "antd";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import Text from "antd/es/typography/Text";

type CopyState = {
  copied: boolean;
  hovered: boolean;
};

function useCopyFeedback() {
  const { message } = App.useApp();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<CopyState>({
    copied: false,
    hovered: false,
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  async function copy(value: string | null | undefined, unavailableMessage: string) {
    const trimmedValue = value?.trim() || "";

    if (!trimmedValue) {
      message.warning(unavailableMessage);
      return;
    }

    try {
      await navigator.clipboard.writeText(trimmedValue);
      setState((currentState) => ({
        ...currentState,
        copied: true,
      }));

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        setState((currentState) => ({
          ...currentState,
          copied: false,
        }));
      }, 1500);
    } catch {
      message.error("复制失败，请重试");
    }
  }

  return {
    copied: state.copied,
    hovered: state.hovered,
    setHovered: (hovered: boolean) => {
      setState((currentState) => ({
        ...currentState,
        hovered,
      }));
    },
    copy,
  };
}

export function CopyIconButton({
  value,
  label,
  unavailableMessage,
}: {
  value: string | null | undefined;
  label: string;
  unavailableMessage: string;
}) {
  const { token } = theme.useToken();
  const { copied, copy } = useCopyFeedback();

  return (
    <Tooltip title={copied ? "已复制" : label}>
      <Button
        type="text"
        size="small"
        aria-label={label}
        icon={
          copied ? (
            <CheckOutlined style={{ color: token.colorSuccess }} />
          ) : (
            <CopyOutlined style={{ color: token.colorTextTertiary }} />
          )
        }
        onClick={() => void copy(value, unavailableMessage)}
        style={{
          borderRadius: 8,
        }}
      />
    </Tooltip>
  );
}

export function CopyCodeButton({
  value,
  label,
  unavailableMessage,
  emptyText,
}: {
  value: string | null | undefined;
  label: string;
  unavailableMessage: string;
  emptyText: string;
}) {
  const { token } = theme.useToken();
  const { copied, hovered, setHovered, copy } = useCopyFeedback();
  const trimmedValue = value?.trim() || "";

  if (!trimmedValue) {
    return (
      <Text
        type="secondary"
        style={{
          fontSize: 12,
        }}
      >
        {emptyText}
      </Text>
    );
  }

  return (
    <Tooltip title={copied ? "已复制" : label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => void copy(trimmedValue, unavailableMessage)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 28,
          padding: "4px 8px",
          borderRadius: 8,
          border: "none",
          background: hovered || copied ? token.colorFillSecondary : "transparent",
          color: hovered || copied ? token.colorText : token.colorTextSecondary,
          transition: "all 0.2s ease",
          cursor: "pointer",
        }}
      >
        <Text
          style={{
            margin: 0,
            fontSize: 12,
            color: hovered || copied ? token.colorText : token.colorTextSecondary,
          }}
        >
          {trimmedValue}
        </Text>
        {copied ? (
          <CheckOutlined
            style={{
              color: token.colorSuccess,
              fontSize: 12,
            }}
          />
        ) : (
          <CopyOutlined
            style={{
              color: hovered ? token.colorTextSecondary : token.colorTextTertiary,
              fontSize: 12,
              opacity: hovered ? 1 : 0.45,
              transition: "all 0.2s ease",
            }}
          />
        )}
      </button>
    </Tooltip>
  );
}
