import FormLayout, { ButtonBlack, Flex, FormField, FormLabel, FormMessage, Textarea } from "@components/StyledElements/Form/Form"
import { BarLoader } from "react-spinners"
import * as Form from '@radix-ui/react-form'
import React, { useState } from "react";
import * as Sentry from '@sentry/browser';
import { CheckCircleIcon } from "lucide-react";
import { useSession } from "@components/Contexts/SessionContext";

export const FeedbackModal = (user: any) => {
    const session = useSession() as any;

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [view, setView] = useState<"feedbackForm" | "success">("feedbackForm")
    const [feedbackMessage, setFeedbackMessage] = useState("");


    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setIsSubmitting(true);

        const user = session.user ? session.user : null;
        const eventId = Sentry.captureMessage(`Feedback from ${user ? user.email : 'Anonymous'} - ${feedbackMessage}`);

        const userFeedback = {
            event_id: eventId,
            name: user ? user.full_name : 'Anonymous',
            email: user ? user.email : 'Anonymous',
            comments: feedbackMessage,
        }
        Sentry.captureUserFeedback(userFeedback);
        setIsSubmitting(false);
        setView("success");
    };

    const handleFeedbackMessage = (event: React.ChangeEvent<any>) => {
        setFeedbackMessage(event.target.value)
    };

    if (view == "feedbackForm") {
        return (
            <FormLayout onSubmit={handleSubmit}>
                <FormField name="feedback-message">
                    <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <FormLabel>Feedback message</FormLabel>
                        <FormMessage match="valueMissing">Please provide learning elements, separated by comma (,)</FormMessage>
                    </Flex>
                    <Form.Control asChild>
                        <Textarea style={{ height: 150, }} onChange={handleFeedbackMessage} required />
                    </Form.Control>
                </FormField>

                <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
                    <Form.Submit asChild>
                        <ButtonBlack type="submit" css={{ marginTop: 10 }}>
                            {isSubmitting ? <BarLoader cssOverride={{ borderRadius: 60, }} width={60} color="#ffffff" />
                                : "Submit Feedback"}
                        </ButtonBlack>
                    </Form.Submit>
                </Flex>
            </FormLayout>
        )
    } else {
        return (
            <div className="flex flex-col items-center space-y-5">
                <div className="flex flex-col items-center space-y-5 pt-10">
                    <div className="flex items-center space-x-2">
                        <div className="text-9xl text-green-500">
                            <CheckCircleIcon></CheckCircleIcon>
                        </div>
                        <div className="text-3xl text-green-500">
                            <div>Thank you for your feedback!</div>
                        </div>
                    </div>
                    <div className="text-xl text-gray-500">
                        <div>We will take it into account.</div>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <ButtonBlack onClick={() => setView("feedbackForm")}>Send another feedback</ButtonBlack>
                </div>
            </div>
        )
    }

}

export default FeedbackModal