"use client";

import { type CSSProperties, useState, useEffect, useRef } from "react";
import {
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Grid,
  Input,
  List,
  Popconfirm,
  Space,
  Spin,
  Splitter,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import Text from "antd/es/typography/Text";
import Title from "antd/es/typography/Title";

interface MoeMailMessage {
  id: string;
  from: string;
  subject: string;
  content?: string;
  text?: string;
  body?: string;
  html?: string;
  timestamp?: number;
  receivedAt?: string;
}

interface MoeMailbox {
  id: string;
  email: string;
  password?: string;
  messageCount?: number;
  latestMessageAt?: string;
  createdAt?: string;
  expiresAt?: string;
  userId?: string;
}

export default function MoeMailPage() {
  const screens = Grid.useBreakpoint();
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const isMobile = viewportWidth !== null ? viewportWidth < 768 : !screens.md;
  const isThreeColumn = !isMobile && (viewportWidth !== null ? viewportWidth >= 1280 : !!screens.xl);
  const isTwoColumn = !isMobile && !isThreeColumn;
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mailboxes, setMailboxes] = useState<MoeMailbox[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MoeMailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [messageDetail, setMessageDetail] = useState<MoeMailMessage | null>(null);
  const [messageDetailLoading, setMessageDetailLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const fetchMailboxes = async (cursor?: string) => {
    if (!cursor) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const url = cursor
        ? `/api/moemail/mailboxes?cursor=${cursor}`
        : "/api/moemail/mailboxes";
      const res = await fetch(url);
      const data = await res.json();

      if (cursor) {
        setMailboxes((prev) => [...prev, ...(data.mailboxes || [])]);
      } else {
        setMailboxes(data.mailboxes || []);
      }

      setNextCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch {
      message.error("加载失败");
    } finally {
      if (!cursor) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  };

  const fetchMessages = async (emailId: string) => {
    setMessagesLoading(true);
    setSelectedMessageId(null);
    setMessageDetail(null);
    try {
      const res = await fetch(`/api/moemail/emails/${emailId}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      message.error("获取邮件失败");
    } finally {
      setMessagesLoading(false);
    }
  };

  const fetchMessageDetail = async (emailId: string, messageId: string) => {
    setMessageDetailLoading(true);
    try {
      const res = await fetch(`/api/moemail/emails/${emailId}/${messageId}`);
      const data = await res.json();
      setMessageDetail(data.message || null);
    } catch {
      message.error("获取邮件详情失败");
    } finally {
      setMessageDetailLoading(false);
    }
  };

  const handleGenerateMailbox = async () => {
    try {
      const res = await fetch("/api/moemail/generate", { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        message.success(`创建成功: ${data.email}`);
        fetchMailboxes();
      } else {
        message.error(data.error || "创建失败");
      }
    } catch {
      message.error("创建失败");
    }
  };

  const handleSelectMailbox = (mailbox: MoeMailbox) => {
    setSelectedMailboxId(mailbox.id);
    setMessages([]);
    setSelectedMessageId(null);
    setMessageDetail(null);
    fetchMessages(mailbox.id);
  };

  const handleSelectMessage = (mailItem: MoeMailMessage) => {
    setSelectedMessageId(mailItem.id);
    if (selectedMailboxId) {
      fetchMessageDetail(selectedMailboxId, mailItem.id);
    }
  };

  const handleCopy = async (value: string, label: string) => {
    if (!value) {
      message.warning(`${label}为空，无法复制`);
      return;
    }

    // 检查是否在浏览器环境
    if (typeof window === "undefined") {
      return;
    }

    try {
      // 优先使用现代 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        message.success(`${label}已复制`);
        return;
      }

      // 降级方案：使用传统方法（支持非 HTTPS 环境）
      const textArea = document.createElement("textarea");
      textArea.value = value;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful) {
        message.success(`${label}已复制`);
      } else {
        message.error("复制失败，请重试");
      }
    } catch (error) {
      console.error("复制失败:", error);
      message.error("复制失败，请重试");
    }
  };

  const handleDeleteMailbox = async (emailId: string) => {
    try {
      const res = await fetch(`/api/moemail/emails/${emailId}/delete`, {
        method: "DELETE",
      });

      if (res.ok) {
        message.success("删除成功");
        if (selectedMailboxId === emailId) {
          setSelectedMailboxId(null);
          setMessages([]);
          setSelectedMessageId(null);
          setMessageDetail(null);
        }
        fetchMailboxes();
      } else {
        const data = await res.json();
        message.error(data.error || "删除失败");
      }
    } catch {
      message.error("删除失败");
    }
  };

  useEffect(() => {
    fetchMailboxes();
  }, []);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (
        scrollHeight - scrollTop - clientHeight < 100 &&
        hasMore &&
        !loading &&
        !loadingMore &&
        !searchValue
      ) {
        if (nextCursor) {
          fetchMailboxes(nextCursor);
        }
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasMore, loading, loadingMore, searchValue, nextCursor]);

  const filteredMailboxes = mailboxes.filter((mailbox) => {
    const keyword = searchValue.trim().toLowerCase();
    return (
      keyword.length === 0 ||
      mailbox.email.toLowerCase().includes(keyword) ||
      mailbox.id.toLowerCase().includes(keyword)
    );
  });

  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId);
  const cardFillStyle = {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  };
  const scrollBodyStyle = { flex: 1, minHeight: 0, minWidth: 0, overflow: "auto" };
  const ellipsisStyle = {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  };
  const activeItemStyle = {
    backgroundColor: "rgba(22, 119, 255, 0.1)",
    borderLeft: "3px solid #1677ff",
  };
  const compactDetailNavigation = isMobile || isTwoColumn;

  const renderEllipsisText = (
    value: string,
    options?: {
      strong?: boolean;
      type?: "secondary";
      prefix?: string;
      style?: CSSProperties;
    },
  ) => (
    <Tooltip title={value}>
      <Text
        strong={options?.strong}
        type={options?.type}
        title={value}
        style={{ ...ellipsisStyle, ...options?.style }}
      >
        {options?.prefix}
        {value}
      </Text>
    </Tooltip>
  );

  const refreshMailboxList = () => {
    setMailboxes([]);
    setNextCursor(undefined);
    setHasMore(true);
    fetchMailboxes();
  };

  const mailboxActions = (
    <Space size={4}>
      <Tooltip title="刷新">
        <Button size="small" icon={<ReloadOutlined />} onClick={refreshMailboxList} />
      </Tooltip>
      <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleGenerateMailbox} />
    </Space>
  );

  const renderMailboxCard = () => (
    <Card
      title={`邮箱 (${filteredMailboxes.length})`}
      style={cardFillStyle}
      styles={{ body: { ...scrollBodyStyle, padding: 0 } }}
      extra={mailboxActions}
    >
      <div ref={listContainerRef} style={{ height: "100%", overflow: "auto", minWidth: 0 }}>
        {loading ? (
          <Flex justify="center" align="center" style={{ padding: 40 }}>
            <Spin />
          </Flex>
        ) : (
          <>
            <List
              dataSource={filteredMailboxes}
              renderItem={(mailbox) => {
                const expiresAt = mailbox.expiresAt ? new Date(mailbox.expiresAt) : null;
                const isPermanent = expiresAt && expiresAt.getFullYear() > 9000;
                const isExpired = expiresAt && !isPermanent && expiresAt < new Date();
                const isActive = selectedMailboxId === mailbox.id;

                return (
                  <List.Item
                    style={{
                      padding: isMobile ? "12px" : "12px 16px",
                      cursor: "pointer",
                      ...(isActive ? activeItemStyle : { borderLeft: "3px solid transparent" }),
                    }}
                    onClick={() => handleSelectMailbox(mailbox)}
                  >
                    <Flex vertical gap={6} style={{ width: "100%", minWidth: 0 }}>
                      <Flex justify="space-between" align="center" gap={8} style={{ minWidth: 0 }}>
                        {renderEllipsisText(mailbox.email, {
                          strong: true,
                          style: { flex: 1 },
                        })}
                        <Space size={4} style={{ flexShrink: 0 }}>
                          <Tooltip title="复制">
                            <Button
                              size="small"
                              type="text"
                              icon={<CopyOutlined />}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleCopy(mailbox.email, "邮箱地址");
                              }}
                            />
                          </Tooltip>
                          <Popconfirm
                            title="确认删除"
                            description="确定要删除这个邮箱吗？"
                            onConfirm={(event) => {
                              event?.stopPropagation();
                              handleDeleteMailbox(mailbox.id);
                            }}
                            onCancel={(event) => event?.stopPropagation()}
                            okText="删除"
                            cancelText="取消"
                          >
                            <Tooltip title="删除">
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </Tooltip>
                          </Popconfirm>
                        </Space>
                      </Flex>
                      <Flex gap={8} align="center" wrap="wrap">
                        {isPermanent ? (
                          <Tag color="green" style={{ margin: 0 }}>永久</Tag>
                        ) : isExpired ? (
                          <Tag color="red" style={{ margin: 0 }}>已过期</Tag>
                        ) : (
                          <Tag color="blue" style={{ margin: 0 }}>可用</Tag>
                        )}
                        {expiresAt && !isPermanent && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {isExpired ? "过期于 " : "到期 "}
                            {expiresAt.toLocaleDateString()}
                          </Text>
                        )}
                      </Flex>
                    </Flex>
                  </List.Item>
                );
              }}
              locale={{ emptyText: <Empty description="暂无邮箱" /> }}
            />
            {loadingMore && nextCursor && (
              <Flex justify="center" style={{ padding: 16 }}>
                <Spin />
              </Flex>
            )}
          </>
        )}
      </div>
    </Card>
  );

  const renderMessageCard = () => (
    <Card
      title={
        selectedMailbox ? (
          <Flex align="center" gap={8} style={{ minWidth: 0 }}>
            <MailOutlined style={{ flexShrink: 0 }} />
            {renderEllipsisText(selectedMailbox.email, { style: { flex: 1 } })}
          </Flex>
        ) : (
          "邮件列表"
        )
      }
      style={cardFillStyle}
      styles={{ body: { ...scrollBodyStyle, padding: 0 } }}
      extra={
        isMobile && selectedMailboxId ? (
          <Button
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              setSelectedMailboxId(null);
              setSelectedMessageId(null);
              setMessageDetail(null);
            }}
          >
            邮箱
          </Button>
        ) : null
      }
    >
      {!selectedMailboxId ? (
        <Flex justify="center" align="center" style={{ height: "100%", padding: 40 }}>
          <Empty description="请选择一个邮箱查看邮件" />
        </Flex>
      ) : messagesLoading ? (
        <Flex justify="center" align="center" style={{ height: "100%", padding: 40 }}>
          <Spin size="large" />
        </Flex>
      ) : messages.length === 0 ? (
        <Flex justify="center" align="center" style={{ height: "100%", padding: 40 }}>
          <Empty description="暂无邮件" />
        </Flex>
      ) : (
        <List
          dataSource={messages}
          renderItem={(mailItem) => {
            const isActive = selectedMessageId === mailItem.id;
            return (
              <List.Item
                style={{
                  padding: isMobile ? "12px" : "16px",
                  cursor: "pointer",
                  ...(isActive ? activeItemStyle : { borderLeft: "3px solid transparent" }),
                }}
                onClick={() => handleSelectMessage(mailItem)}
              >
                <Flex vertical gap={8} style={{ width: "100%", minWidth: 0 }}>
                  <Flex justify="space-between" align="flex-start" gap={8} style={{ minWidth: 0 }}>
                    {renderEllipsisText(mailItem.subject || "(无主题)", {
                      strong: true,
                      style: { flex: 1 },
                    })}
                    <Text type="secondary" className="arm-ellipsis" style={{ fontSize: 12, flexShrink: 0, maxWidth: 110 }}>
                      {mailItem.receivedAt ||
                        (mailItem.timestamp ? new Date(mailItem.timestamp * 1000).toLocaleString() : "")}
                    </Text>
                  </Flex>
                  {renderEllipsisText(mailItem.from, {
                    type: "secondary",
                    prefix: "发件人: ",
                    style: { fontSize: 12 },
                  })}
                  {renderEllipsisText(mailItem.text || mailItem.content || mailItem.subject || "(无内容)", {
                    type: "secondary",
                    style: { fontSize: 13 },
                  })}
                </Flex>
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );

  const renderMessageDetailCard = () => (
    <Card
      title="邮件详情"
      style={cardFillStyle}
      styles={{ body: { ...scrollBodyStyle, padding: isMobile ? 12 : 16 } }}
      extra={
        compactDetailNavigation && selectedMessageId ? (
          <Button
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              setSelectedMessageId(null);
              setMessageDetail(null);
            }}
          >
            邮件
          </Button>
        ) : null
      }
    >
      {!selectedMessageId ? (
        <Flex justify="center" align="center" style={{ height: "100%", padding: 40 }}>
          <Empty description="请选择一封邮件查看详情" />
        </Flex>
      ) : messageDetailLoading ? (
        <Flex justify="center" align="center" style={{ height: "100%", padding: 40 }}>
          <Spin size="large" />
        </Flex>
      ) : messageDetail ? (
        <Flex vertical gap={16} style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
          <div style={{ minWidth: 0 }}>
            <Text type="secondary">主题</Text>
            <Title level={5} style={{ marginTop: 8, overflowWrap: "anywhere" }}>
              {messageDetail.subject || "(无主题)"}
            </Title>
          </div>
          <div style={{ minWidth: 0 }}>
            <Text type="secondary">发件人</Text>
            <div style={{ marginTop: 8, minWidth: 0 }}>
              <Text style={{ overflowWrap: "anywhere" }}>{messageDetail.from}</Text>
            </div>
          </div>
          <div>
            <Text type="secondary">时间</Text>
            <div style={{ marginTop: 8 }}>
              <Flex align="center" gap={8}>
                <ClockCircleOutlined />
                <Text>
                  {messageDetail.receivedAt ||
                    (messageDetail.timestamp ? new Date(messageDetail.timestamp * 1000).toLocaleString() : "")}
                </Text>
              </Flex>
            </div>
          </div>
          <Divider />
          <div>
            <Text type="secondary">内容</Text>
            <div
              className="moemail-message-content"
              style={{
                marginTop: 8,
                padding: isMobile ? 12 : 16,
                backgroundColor: "var(--surface-muted)",
                borderRadius: 8,
                maxWidth: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                overflowX: "auto",
                overflowY: "hidden",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
              dangerouslySetInnerHTML={{
                __html:
                  messageDetail.html ||
                  messageDetail.content ||
                  messageDetail.text ||
                  messageDetail.body ||
                  "(无内容)",
              }}
            />
          </div>
        </Flex>
      ) : (
        <Empty description="加载失败" />
      )}
    </Card>
  );

  const renderMobileContent = () => {
    if (!selectedMailboxId) {
      return renderMailboxCard();
    }
    if (!selectedMessageId) {
      return renderMessageCard();
    }
    return renderMessageDetailCard();
  };

  if (isMobile) {
    return (
      <Flex
        vertical
        gap={12}
        style={{
          height: "calc(100dvh - var(--arm-header-height) - 32px)",
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {!selectedMailboxId && (
          <Card className="arm-responsive-card" style={{ flexShrink: 0 }}>
            <Input
              allowClear
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              prefix={<SearchOutlined />}
              placeholder="搜索邮箱地址或 ID"
              style={{ width: "100%" }}
            />
          </Card>
        )}

        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          {renderMobileContent()}
        </div>

        <style>{`
          .moemail-message-content img,
          .moemail-message-content video,
          .moemail-message-content iframe {
            max-width: 100%;
            height: auto;
          }
          .moemail-message-content,
          .moemail-message-content * {
            max-width: 100%;
            overflow-wrap: anywhere;
            word-break: break-word;
            box-sizing: border-box;
          }
          .moemail-message-content pre,
          .moemail-message-content code {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .moemail-message-content table {
            max-width: 100%;
            display: block;
            overflow-x: auto;
          }
        `}</style>
      </Flex>
    );
  }

  return (
    <Flex
      vertical
      gap={16}
      style={{
        height: "calc(100vh - var(--arm-header-height) - 48px)",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Card className="arm-responsive-card" style={{ flexShrink: 0 }}>
        <Input
          allowClear
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          prefix={<SearchOutlined />}
          placeholder="搜索邮箱地址或 ID"
          style={{ width: "100%", maxWidth: 400 }}
        />
      </Card>

      {isTwoColumn ? (
        <Splitter style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          <Splitter.Panel defaultSize="38%" min={280} max="48%">
            {renderMailboxCard()}
          </Splitter.Panel>
          <Splitter.Panel min={360}>
            {selectedMessageId ? renderMessageDetailCard() : renderMessageCard()}
          </Splitter.Panel>
        </Splitter>
      ) : (
        <Splitter style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          <Splitter.Panel defaultSize="24%" min={280} max="34%">
            {renderMailboxCard()}
          </Splitter.Panel>
          <Splitter.Panel defaultSize="26%" min={320} max="36%">
            {renderMessageCard()}
          </Splitter.Panel>
          <Splitter.Panel min={420}>
            {renderMessageDetailCard()}
          </Splitter.Panel>
        </Splitter>
      )}

      <style>{`
        .moemail-message-content img,
        .moemail-message-content video,
        .moemail-message-content iframe {
          max-width: 100%;
          height: auto;
        }
        .moemail-message-content,
        .moemail-message-content * {
          max-width: 100%;
          overflow-wrap: anywhere;
          word-break: break-word;
          box-sizing: border-box;
        }
        .moemail-message-content pre,
        .moemail-message-content code {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .moemail-message-content table {
          max-width: 100%;
          display: block;
          overflow-x: auto;
        }
      `}</style>
    </Flex>
  );
}
